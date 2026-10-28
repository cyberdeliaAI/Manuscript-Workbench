"""Markdown structure vocabulary shared by DOCX import/export, preview and preflight."""
from __future__ import annotations

import re
from typing import List, Optional, Sequence, Tuple


PARAGRAPH_STYLE_MAP = {
    "chapter": "Heading 1",
    "part": "Heading 1",
    "subhead1": "Heading 2",
    "subhead2": "Heading 3",
    "subhead3": "Heading 4",
    "subhead4": "Heading 5",
    "subhead5": "Heading 6",
    "subtitle": "Manuscript Element Subtitle",
    "element-author": "Manuscript Element Author",
    "hidden-heading": "Manuscript Hidden Heading",
    "quote": "Manuscript Block Quote",
    "verse": "Manuscript Verse",
    "attribution": "Manuscript Attribution",
    "centered": "Manuscript Centered Text",
    "flush-left": "Manuscript Flush Left",
    "written-note": "Manuscript Written Note",
    "text-conversation": "Manuscript Text Conversation",
    "caption": "Caption",
    "inline-image": "Manuscript Inline Image",
    "ornament": "Normal",
    "scene": "Normal",
}

STYLE_TO_MARKER = {
    "Heading 1": "chapter",
    "Heading 2": "subhead1",
    "Heading 3": "subhead2",
    "Heading 4": "subhead3",
    "Heading 5": "subhead4",
    "Heading 6": "subhead5",
    "Quote": "quote",
    "Intense Quote": "quote",
    "Caption": "caption",
    "Manuscript Element Subtitle": "subtitle",
    "Manuscript Element Author": "element-author",
    "Manuscript Hidden Heading": "hidden-heading",
    "Manuscript Block Quote": "quote",
    "Manuscript Verse": "verse",
    "Manuscript Attribution": "attribution",
    "Manuscript Centered Text": "centered",
    "Manuscript Flush Left": "flush-left",
    "Manuscript Written Note": "written-note",
    "Manuscript Text Conversation": "text-conversation",
    "Manuscript Inline Image": "inline-image",
    "Vellum Element Subtitle": "subtitle",
    "Vellum Element Author": "element-author",
    "Vellum Hidden Heading": "hidden-heading",
    "Vellum Block Quote": "quote",
    "Vellum Verse": "verse",
    "Vellum Attribution": "attribution",
    "Vellum Centered Text": "centered",
    "Vellum Flush Left": "flush-left",
    "Vellum Written Note": "written-note",
    "Vellum Text Conversation": "text-conversation",
    "Vellum Inline Image": "inline-image",
}

MARKDOWN_HEADING_TO_MARKER = {
    1: "chapter",
    2: "subhead1",
    3: "subhead2",
    4: "subhead3",
    5: "subhead4",
    6: "subhead5",
}

MARKDOWN_CONTAINER_ALIASES = {
    "note": "written-note",
    "written-note": "written-note",
    "text": "text-conversation",
    "text-conversation": "text-conversation",
    "verse": "verse",
    "quote": "quote",
    "attribution": "attribution",
    "centered": "centered",
    "flush-left": "flush-left",
    "caption": "caption",
    "image": "inline-image",
    "inline-image": "inline-image",
    "subtitle": "subtitle",
    "element-author": "element-author",
    "hidden-heading": "hidden-heading",
}

MARKDOWN_CONTAINER_RE = re.compile(r"^\s*:::\s*([a-z0-9_-]+)?\s*$", re.I)


def canonical_structure_marker(marker: str) -> str:
    return MARKDOWN_CONTAINER_ALIASES.get((marker or "").lower(), (marker or "").lower())


def is_part_heading(content: str) -> bool:
    return bool(re.match(r"^\s*(?:part|deel)\b", content or "", re.I))


def markdown_line_marker(line: str) -> Tuple[str, str]:
    stripped = line.strip()
    heading = re.match(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$", line)
    if heading:
        content = heading.group(2).strip()
        level = len(heading.group(1))
        if level == 1 and is_part_heading(content):
            return "part", content
        return MARKDOWN_HEADING_TO_MARKER.get(level, ""), content
    quote = re.match(r"^\s{0,3}>\s?(.*)$", line)
    if quote:
        return "quote", quote.group(1).strip()
    if re.fullmatch(r"(?:\*\s*){3,}|[-–—]{3,}|~{3,}", stripped):
        return "scene", ""
    return "", line


def structure_marker_for_line(line: str, block_marker: str = "") -> Tuple[str, str]:
    marker, content = markdown_line_marker(line)
    if marker:
        return marker, content
    if block_marker and line.strip():
        return block_marker, line.strip()
    return "", line


def strip_structure_line(line: str) -> str:
    marker, content = structure_marker_for_line(line)
    return content.rstrip() if marker else line.rstrip()


# ---- lists and tables ------------------------------------------------------------------------------------------

LIST_ITEM_RE = re.compile(r"^([ \t]*)([-+*]|\d{1,9}[.)])[ \t]+(\S.*?)\s*$")


def list_item(line: str) -> Optional[Tuple[int, bool, int, str]]:
    """A Markdown list item as (indent width, ordered, number, text), or None. A tab counts as four spaces."""
    match = LIST_ITEM_RE.match(line.rstrip("\r"))
    if not match:
        return None
    marker = match.group(2)
    ordered = marker[0].isdigit()
    return len(match.group(1).replace("\t", "    ")), ordered, int(marker[:-1]) if ordered else 0, match.group(3)


def is_table_separator(line: str) -> bool:
    """The |---|:---:| row under a table header (like Python-Markdown, any number of dashes, one column is enough)."""
    if "|" not in line:
        return False
    cells = split_table_row(line)
    return bool(cells) and all(re.fullmatch(r":?-+:?", cell) for cell in cells)


def is_table_start(lines: Sequence[str], index: int) -> bool:
    """True when lines[index] is the header row of a pipe table (the next line is its |---|---| separator)."""
    return index + 1 < len(lines) and "|" in lines[index] and is_table_separator(lines[index + 1].rstrip("\r"))


def split_table_row(line: str) -> List[str]:
    """The cells of a pipe table row. An escaped pipe (\\|) stays inside its cell."""
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|") and not text.endswith("\\|"):
        text = text[:-1]
    return [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", text)]


def table_alignments(separator: str) -> List[str]:
    """'left', 'right', 'center' or '' for every column, from the :---: marks of the separator row."""
    result = []
    for cell in split_table_row(separator):
        left, right = cell.startswith(":"), cell.endswith(":")
        result.append("center" if left and right else "right" if right else "left" if left else "")
    return result


def read_table(lines: Sequence[str], index: int) -> Tuple[List[str], List[str], List[List[str]], int]:
    """Reads the pipe table that starts at lines[index]: (header cells, alignments, body rows, index after the table)."""
    header = split_table_row(lines[index])
    alignments = table_alignments(lines[index + 1])
    rows: List[List[str]] = []
    position = index + 2
    while position < len(lines) and lines[position].strip() and "|" in lines[position]:
        rows.append(split_table_row(lines[position]))
        position += 1
    return header, alignments, rows, position
