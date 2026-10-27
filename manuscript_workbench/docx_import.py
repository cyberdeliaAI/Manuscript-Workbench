"""DOCX to Markdown import."""
from __future__ import annotations

import os
import re
import tempfile
from typing import Any, List, Tuple

from .deps import Document
from .structure import STYLE_TO_MARKER
from .textio import normalize_line_endings


def import_docx_bytes(data: bytes) -> Tuple[str, List[str]]:
    if Document is None:
        raise RuntimeError("python-docx is not installed. Run: pip install -r requirements.txt")
    with tempfile.NamedTemporaryFile(delete=False, suffix=".docx") as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        doc = Document(path)
        lines: List[str] = []
        for p in doc.paragraphs:
            style_name = p.style.name if p.style is not None else ""
            marker = STYLE_TO_MARKER.get(style_name)
            text = paragraph_runs_to_marked_text(p)
            plain = text.strip()
            if not marker and plain and re.fullmatch(r"(?:[*•·]\s*){3,}|[-–—]{3,}|#", plain):
                # Practical round-trip for common ornamental/scene-break lines.
                marker = "ornament"
            if marker:
                lines.append(marker_to_markdown_text(marker, text))
            else:
                lines.append(text)
        text = "\n".join(lines)
        text, notes = normalize_line_endings(text)
        notes.insert(0, f"Imported DOCX paragraphs: {len(lines):,}")
        if getattr(doc, "tables", None):
            notes.append(f"Skipped DOCX tables: {len(doc.tables):,}")
        return text, notes
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


def paragraph_runs_to_marked_text(p: Any) -> str:
    pieces: List[str] = []
    for run in p.runs:
        text = run.text or ""
        if not text:
            continue
        style_name = run.style.name if run.style is not None else ""
        if style_name in ("Manuscript Small Caps", "Vellum Small Caps"):
            pieces.append(f"[[sc:{text}]]")
        elif style_name in ("Manuscript Monospace", "Vellum Monospace"):
            pieces.append(f"[[mono:{text}]]")
        elif style_name in ("Manuscript Sans Serif", "Vellum Sans Serif"):
            pieces.append(f"[[sans:{text}]]")
        elif run.underline:
            pieces.append(f"[[u:{text}]]")
        elif run.bold and run.italic:
            pieces.append(f"***{text}***")
        elif run.bold:
            pieces.append(f"**{text}**")
        elif run.italic:
            pieces.append(f"*{text}*")
        else:
            pieces.append(text)
    return "".join(pieces)


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
