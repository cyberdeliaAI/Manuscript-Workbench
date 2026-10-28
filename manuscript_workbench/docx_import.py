"""DOCX to Markdown import: paragraphs, lists and tables in document order."""
from __future__ import annotations

import os
import re
import tempfile
from typing import Any, Dict, Iterator, List, Optional, Tuple

from .deps import Document, qn
from .structure import STYLE_TO_MARKER
from .textio import normalize_line_endings

LIST_INDENT = "    "  # Python-Markdown only nests a list that is indented by four spaces


def import_docx_bytes(data: bytes) -> Tuple[str, List[str]]:
    if Document is None:
        raise RuntimeError("python-docx is not installed. Run: pip install -r requirements.txt")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        doc = Document(path)
        converter = DocxConverter(doc)
        text = "\n".join(converter.convert())
        text, notes = normalize_line_endings(text)
        notes.insert(0, f"Imported DOCX paragraphs: {converter.paragraphs:,}")
        if converter.list_items:
            notes.append(f"Converted DOCX list items to Markdown lists: {converter.list_items:,}")
        if converter.tables:
            notes.append(f"Converted DOCX tables to Markdown tables: {converter.tables:,}")
        if converter.nested_tables:
            notes.append(f"Skipped tables nested inside DOCX table cells: {converter.nested_tables:,}")
        images = count_images(doc)
        if images:
            notes.append(f"Skipped DOCX images: {images:,}")
        footnotes = count_footnotes(doc)
        if footnotes:
            notes.append(f"Skipped DOCX footnotes/endnotes: {footnotes:,} (their text is not in the Markdown)")
        return text, notes
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


def count_images(doc: Any) -> int:
    try:
        return len(doc.inline_shapes)
    except Exception:
        return 0


def count_footnotes(doc: Any) -> int:
    """Footnotes and endnotes with real content (Word always keeps two separator notes in the part)."""
    total = 0
    try:
        for part in doc.part.package.iter_parts():
            name = str(part.partname)
            if name.endswith("/footnotes.xml") or name.endswith("/endnotes.xml"):
                from lxml import etree

                root = etree.fromstring(part.blob)
                for note in root:
                    if note.get(qn("w:type")) in (None, "normal") and any(t.text for t in note.iter(qn("w:t"))):
                        total += 1
    except Exception:
        return total
    return total


# ---- numbering definitions (which numbers are bullets, and where a numbered list starts) ----------------

class NumberingInfo:
    def __init__(self, doc: Any) -> None:
        self.formats: Dict[str, Dict[int, str]] = {}  # abstractNumId -> {ilvl: numFmt}
        self.starts: Dict[str, Dict[int, int]] = {}  # abstractNumId -> {ilvl: start}
        self.instances: Dict[str, Tuple[str, Dict[int, int]]] = {}  # numId -> (abstractNumId, {ilvl: startOverride})
        try:
            root = doc.part.numbering_part.element
        except Exception:
            return
        for abstract in root.findall(qn("w:abstractNum")):
            abstract_id = abstract.get(qn("w:abstractNumId"))
            for level in abstract.findall(qn("w:lvl")):
                ilvl = int(level.get(qn("w:ilvl"), "0"))
                fmt = level.find(qn("w:numFmt"))
                start = level.find(qn("w:start"))
                self.formats.setdefault(abstract_id, {})[ilvl] = fmt.get(qn("w:val")) if fmt is not None else "decimal"
                self.starts.setdefault(abstract_id, {})[ilvl] = int(start.get(qn("w:val"), "1")) if start is not None else 1
        for num in root.findall(qn("w:num")):
            reference = num.find(qn("w:abstractNumId"))
            if reference is None:
                continue
            overrides: Dict[int, int] = {}
            for override in num.findall(qn("w:lvlOverride")):
                restart = override.find(qn("w:startOverride"))
                if restart is not None:
                    overrides[int(override.get(qn("w:ilvl"), "0"))] = int(restart.get(qn("w:val"), "1"))
            self.instances[num.get(qn("w:numId"))] = (reference.get(qn("w:val")), overrides)

    def number_format(self, num_id: str, ilvl: int) -> Optional[str]:
        abstract = self.instances.get(num_id)
        if not abstract:
            return None
        formats = self.formats.get(abstract[0], {})
        return formats.get(ilvl, formats.get(0))

    def start(self, num_id: str, ilvl: int) -> int:
        abstract, overrides = self.instances.get(num_id, ("", {}))
        if ilvl in overrides:
            return overrides[ilvl]
        return self.starts.get(abstract, {}).get(ilvl, 1)


def style_level(style_name: str) -> int:
    match = re.search(r"\s(\d)$", style_name or "")
    return max(0, int(match.group(1)) - 1) if match else 0


def numbering_of(p: Any) -> Optional[Tuple[str, int]]:
    """(numId, ilvl) of the list a paragraph belongs to: its own numbering, or that of its style (or a base style)."""
    properties = p._p.pPr
    num_id = ilvl = None
    if properties is not None and properties.numPr is not None:
        if properties.numPr.numId is not None:
            num_id = str(properties.numPr.numId.val)
        if properties.numPr.ilvl is not None:
            ilvl = int(properties.numPr.ilvl.val)
    style = p.style
    while style is not None and (num_id is None or ilvl is None):
        style_properties = style.element.pPr
        if style_properties is not None and style_properties.numPr is not None:
            if num_id is None and style_properties.numPr.numId is not None:
                num_id = str(style_properties.numPr.numId.val)
            if ilvl is None and style_properties.numPr.ilvl is not None:
                ilvl = int(style_properties.numPr.ilvl.val)
        style = style.base_style
    if num_id is None or num_id == "0":
        return None
    return num_id, ilvl or 0


# ---- the converter -----------------------------------------------------------------------------------------

class DocxConverter:
    def __init__(self, doc: Any) -> None:
        self.doc = doc
        self.numbering = NumberingInfo(doc)
        self.counters: Dict[str, Dict[int, int]] = {}
        self.paragraphs = 0
        self.list_items = 0
        self.tables = 0
        self.nested_tables = 0

    def blocks(self) -> Iterator[Any]:
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        for child in self.doc.element.body.iterchildren():
            if child.tag == qn("w:p"):
                yield Paragraph(child, self.doc)
            elif child.tag == qn("w:tbl"):
                yield Table(child, self.doc)

    def convert(self) -> List[str]:
        lines: List[str] = []
        last = ""  # what came last: "text", "list", "table" or "blank"
        for block in self.blocks():
            if hasattr(block, "rows"):
                self.tables += 1
                if last in ("text", "list"):
                    lines.append("")  # a table only renders as one after a blank line
                lines.extend(self.table_lines(block))
                last = "table"
                continue
            line, kind = self.paragraph_line(block)
            self.paragraphs += 1
            if not line.strip():
                lines.append(line)
                last = "blank"
                continue
            if (kind == "list" and last in ("text", "table")) or (kind == "text" and last in ("list", "table")):
                lines.append("")  # a list needs a blank line before it, and text a blank line after a list or table
            lines.append(line)
            last = kind
        return lines

    def paragraph_line(self, p: Any) -> Tuple[str, str]:
        style_name = p.style.name if p.style is not None else ""
        marker = STYLE_TO_MARKER.get(style_name)
        text = paragraph_runs_to_marked_text(p)
        plain = text.strip()
        if not marker and plain and re.fullmatch(r"(?:[*•·]\s*){3,}|[-–—]{3,}|#", plain):
            # Practical round-trip for common ornamental/scene-break lines.
            marker = "ornament"
        if marker:
            return marker_to_markdown_text(marker, text), "text"
        item = self.list_line(p, style_name) if plain else None
        if item is not None:
            self.list_items += 1
            return item, "list"
        return text, "text"

    def list_line(self, p: Any, style_name: str) -> Optional[str]:
        numbering = numbering_of(p)
        by_style = re.match(r"List (Bullet|Number)\b", style_name or "")
        if numbering is None and not by_style:
            return None
        num_id, ilvl = numbering if numbering else ("", 0)
        fmt = self.numbering.number_format(num_id, ilvl) if num_id else None
        if by_style:
            ordered = by_style.group(1) == "Number"
        elif fmt in (None, "none"):
            return None
        else:
            ordered = fmt != "bullet"
        level = style_level(style_name) + ilvl if by_style else ilvl
        text = paragraph_runs_to_marked_text(p).strip()
        if not ordered:
            return f"{LIST_INDENT * level}- {text}"
        counts = self.counters.setdefault(num_id, {})
        for deeper in [lvl for lvl in counts if lvl > ilvl]:
            del counts[deeper]
        counts[ilvl] = counts[ilvl] + 1 if ilvl in counts else self.numbering.start(num_id, ilvl)
        return f"{LIST_INDENT * level}{counts[ilvl]}. {text}"

    def table_lines(self, table: Any) -> List[str]:
        from docx.table import _Cell

        grid: List[List[Tuple[str, str]]] = []  # rows of (text, alignment)
        for r, row in enumerate(table.rows):
            cells: List[Tuple[str, str]] = []
            for tc in row._tr.tc_lst:
                cell = _Cell(tc, table)
                span = max(1, tc.grid_span or 1)
                text, align = "", ""
                if tc.vMerge != "continue":
                    parts = []
                    for paragraph in cell.paragraphs:
                        piece = paragraph_runs_to_marked_text(paragraph, ignore_bold=(r == 0)).strip()
                        if piece:
                            parts.append(piece)
                    if cell._tc.xpath(".//w:tbl"):
                        self.nested_tables += 1
                    text = "<br>".join(parts).replace("\n", "<br>").replace("|", "\\|")
                    first = cell.paragraphs[0].alignment if cell.paragraphs else None
                    align = {"LEFT": "left", "CENTER": "center", "RIGHT": "right"}.get(getattr(first, "name", ""), "")
                cells.append((text, align))
                cells.extend(("", "") for _ in range(span - 1))
            grid.append(cells)
        if not grid:
            return []
        columns = max(len(cells) for cells in grid)
        for cells in grid:
            cells.extend(("", "") for _ in range(columns - len(cells)))
        source_row = grid[1] if len(grid) > 1 else grid[0]
        marks = {"left": ":---", "center": ":---:", "right": "---:", "": "---"}
        lines = ["| " + " | ".join(text for text, _ in grid[0]) + " |"]
        lines.append("| " + " | ".join(marks[align] for _, align in source_row) + " |")
        for cells in grid[1:]:
            lines.append("| " + " | ".join(text for text, _ in cells) + " |")
        return lines


# ---- inline text -------------------------------------------------------------------------------------------

def _format_run(run: Any, ignore_bold: bool) -> str:
    text = run.text or ""
    if not text:
        return ""
    style_name = run.style.name if run.style is not None else ""
    bold = run.bold and not ignore_bold
    if style_name in ("Manuscript Small Caps", "Vellum Small Caps"):
        return f"[[sc:{text}]]"
    if style_name in ("Manuscript Monospace", "Vellum Monospace"):
        return f"[[mono:{text}]]"
    if style_name in ("Manuscript Sans Serif", "Vellum Sans Serif"):
        return f"[[sans:{text}]]"
    if run.underline:
        return f"[[u:{text}]]"
    if bold and run.italic:
        return f"***{text}***"
    if bold:
        return f"**{text}**"
    if run.italic:
        return f"*{text}*"
    return text


def _inline(container: Any, p: Any, ignore_bold: bool) -> str:
    """The text of a paragraph, hyperlink, tracked insertion... with the run formatting as Markdown markers."""
    from docx.text.run import Run

    pieces: List[str] = []
    for child in container:
        if child.tag == qn("w:r"):
            pieces.append(_format_run(Run(child, p), ignore_bold))
        elif child.tag == qn("w:hyperlink"):
            label = _inline(child, p, ignore_bold)
            url = hyperlink_target(p, child)
            pieces.append(f"[{label}]({url})" if url and label.strip() else label)
        elif child.tag in (qn("w:ins"), qn("w:smartTag"), qn("w:fldSimple")):
            pieces.append(_inline(child, p, ignore_bold))
    return "".join(pieces)


def paragraph_runs_to_marked_text(p: Any, ignore_bold: bool = False) -> str:
    return _inline(p._p, p, ignore_bold)


def hyperlink_target(p: Any, element: Any) -> str:
    """The web address of a hyperlink (None for a link to a place inside the document)."""
    rid = element.get(qn("r:id"))
    if not rid:
        return ""
    try:
        relation = p.part.rels[rid]
    except KeyError:
        return ""
    target = getattr(relation, "target_ref", "") or ""
    return target if re.match(r"^(?:https?|mailto):", target, re.I) else ""


def marker_to_markdown_text(marker: str, text: str) -> str:
    text = (text or "").strip()
    prefixes = {
        "chapter": "# ",
        "part": "# ",
        "subhead1": "## ",
        "subhead2": "### ",
        "subhead3": "#### ",
        "subhead4": "##### ",
        "subhead5": "###### ",
        "quote": "> ",
    }
    if marker in prefixes:
        return (prefixes[marker] + text).rstrip()
    if marker in ("scene", "ornament"):
        return "***"
    if not text:
        return f"::: {marker}\n:::"
    return f"::: {marker}\n{text}\n:::"
