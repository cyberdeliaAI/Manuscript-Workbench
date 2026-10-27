"""File import dispatcher (TXT/MD/RTF/DOCX/HTML)."""
from __future__ import annotations

import re
from typing import Any, Dict, List

from .docx_import import import_docx_bytes
from .htmlimport import html_to_text, trafilatura_html_to_text
from .textio import decode_text_bytes, rtf_to_text


def import_file(filename: str, data: bytes, html_mode: str = "main") -> Dict[str, Any]:
    lower = filename.lower()
    notes: List[str] = []
    sniff = data[:4096].lstrip()
    is_docx = data.startswith(b"PK\x03\x04")
    is_rtf = sniff.startswith(b"{\\rtf")
    is_html = bool(re.match(br"(?is)^(?:<!doctype\s+html|<html\b|<!--.*?-->\s*<html\b|<head\b|<body\b)", sniff))
    if lower.endswith(".doc") and not lower.endswith(".docx"):
        raise ValueError(".doc is an old binary Word format. Please save it as .docx, .rtf, or .txt first.")
    if lower.endswith(".docx") or is_docx:
        text, notes = import_docx_bytes(data)
        if is_docx and not lower.endswith(".docx"):
            notes.insert(0, "Detected DOCX content from file signature")
    elif lower.endswith(".rtf") or is_rtf:
        decoded, notes = decode_text_bytes(data)
        text = rtf_to_text(decoded)
        notes.insert(0, "Imported RTF as plain text" if lower.endswith(".rtf") else "Detected RTF content and imported as plain text")
    elif lower.endswith((".html", ".htm")) or is_html:
        decoded, notes = decode_text_bytes(data)
        if html_mode == "simple":
            text = html_to_text(decoded)
            notes.insert(0, "Imported HTML with simple extraction" if lower.endswith((".html", ".htm")) else "Detected HTML content and imported with simple extraction")
        else:
            try:
                text = trafilatura_html_to_text(decoded)
                notes.insert(0, "Imported HTML main text with Trafilatura")
            except Exception as exc:
                text = html_to_text(decoded)
                notes.insert(0, f"Trafilatura failed; used simple HTML extraction: {exc}")
    elif lower.endswith((".md", ".markdown")):
        text, notes = decode_text_bytes(data)
        notes.insert(0, "Imported Markdown")
    else:
        text, notes = decode_text_bytes(data)
    return {"text": text, "notes": notes, "filename": filename}
