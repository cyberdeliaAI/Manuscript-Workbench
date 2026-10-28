"""Text decoding and normalisation helpers (encodings, line endings, RTF, file names)."""
from __future__ import annotations

import re
from typing import List, Tuple


def normalize_line_endings(text: str) -> Tuple[str, List[str]]:
    notes: List[str] = []
    if text.startswith("\ufeff"):
        text = text[1:]
        notes.append("BOM removed")
    if "\r\n" in text:
        text = text.replace("\r\n", "\n")
        notes.append("CRLF → LF")
    if "\r" in text:
        text = text.replace("\r", "\n")
        notes.append("CR → LF")
    return text, notes


def decode_text_bytes(data: bytes) -> Tuple[str, List[str]]:
    notes: List[str] = []
    if data.startswith(b"\xff\xfe"):
        text = data[2:].decode("utf-16-le", errors="replace")
        notes.append("Read as UTF-16 LE")
    elif data.startswith(b"\xfe\xff"):
        text = data[2:].decode("utf-16-be", errors="replace")
        notes.append("Read as UTF-16 BE")
    elif data.startswith(b"\xef\xbb\xbf"):
        text = data[3:].decode("utf-8", errors="replace")
        notes.append("Read as UTF-8 BOM")
    else:
        text = data.decode("utf-8", errors="replace")
        # Heuristic: a UTF-16 file without BOM usually contains many NUL bytes after UTF-8 decode.
        if text.count("\x00") > max(4, len(text) // 50):
            even_nuls = data[0::2].count(0)
            odd_nuls = data[1::2].count(0)
            try:
                if odd_nuls > even_nuls:
                    text = data.decode("utf-16-le", errors="replace")
                    notes.append("Read as UTF-16 LE by NUL-byte heuristic")
                else:
                    text = data.decode("utf-16-be", errors="replace")
                    notes.append("Read as UTF-16 BE by NUL-byte heuristic")
            except Exception:
                pass
        elif "\ufffd" in text:
            alt = data.decode("windows-1252", errors="replace")
            if alt.count("\ufffd") < text.count("\ufffd"):
                text = alt
                notes.append("Read as Windows-1252")
            else:
                notes.append("Read as UTF-8 with replacement characters")
        else:
            notes.append("Read as UTF-8")
    text, norm_notes = normalize_line_endings(text)
    notes.extend(norm_notes)
    return text, notes


def rtf_to_text(rtf: str) -> str:
    """Small, dependency-free RTF-to-text extractor. Good enough for manuscripts.

    It handles common paragraph, tab, escaped hex, and unicode tokens. It intentionally
    ignores most formatting and many RTF destinations.
    """
    ignorable_destinations = {
        "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer",
        "generator", "themedata", "datastore", "xmlnstbl", "listtable", "listoverridetable",
        "revtbl", "rsidtbl", "latentstyles", "filetbl", "aftnsep", "aftnsepc", "aftncn",
    }
    stack: List[Tuple[bool, int]] = []
    out: List[str] = []
    i = 0
    n = len(rtf)
    skip_group = False
    ucskip = 1
    pending_ignorable = False

    def emit(s: str) -> None:
        if not skip_group:
            out.append(s)

    while i < n:
        c = rtf[i]
        if c == "{":
            stack.append((skip_group, ucskip))
            pending_ignorable = False
            i += 1
        elif c == "}":
            if stack:
                skip_group, ucskip = stack.pop()
            pending_ignorable = False
            i += 1
        elif c == "\\":
            i += 1
            if i >= n:
                break
            c2 = rtf[i]
            if c2 in "{}\\":
                emit(c2)
                i += 1
            elif c2 == "~":
                emit(" ")
                i += 1
            elif c2 == "-":
                emit("-")
                i += 1
            elif c2 == "_":
                emit("-")
                i += 1
            elif c2 == "*":
                pending_ignorable = True
                i += 1
            elif c2 == "'" and i + 2 < n:
                hx = rtf[i + 1:i + 3]
                try:
                    emit(bytes.fromhex(hx).decode("windows-1252", errors="replace"))
                except Exception:
                    pass
                i += 3
            elif c2.isalpha():
                start = i
                while i < n and rtf[i].isalpha():
                    i += 1
                word = rtf[start:i]
                sign = 1
                if i < n and rtf[i] == "-":
                    sign = -1
                    i += 1
                num_start = i
                while i < n and rtf[i].isdigit():
                    i += 1
                arg = None
                if i > num_start:
                    arg = int(rtf[num_start:i]) * sign
                if i < n and rtf[i] == " ":
                    i += 1

                if pending_ignorable or word in ignorable_destinations:
                    skip_group = True
                    pending_ignorable = False
                    continue
                pending_ignorable = False

                if word in ("par", "pard", "line"):
                    emit("\n")
                elif word == "tab":
                    emit("\t")
                elif word == "emdash":
                    emit("—")
                elif word == "endash":
                    emit("–")
                elif word == "bullet":
                    emit("•")
                elif word == "lquote":
                    emit("‘")
                elif word == "rquote":
                    emit("’")
                elif word == "ldblquote":
                    emit("“")
                elif word == "rdblquote":
                    emit("”")
                elif word == "uc" and arg is not None:
                    ucskip = max(0, arg)
                elif word == "u" and arg is not None:
                    codepoint = arg if arg >= 0 else arg + 65536
                    try:
                        emit(chr(codepoint))
                    except Exception:
                        pass
                    # Skip fallback chars/tokens after unicode escape.
                    skip = ucskip
                    while skip > 0 and i < n:
                        if rtf[i] == "\\":
                            # Skip an escaped fallback token as one char.
                            i += 1
                            if i < n and rtf[i] == "'" and i + 2 < n:
                                i += 3
                            elif i < n:
                                i += 1
                        else:
                            i += 1
                        skip -= 1
                # all other controls are formatting; ignore.
            else:
                # Control symbol; usually formatting. Consume it.
                i += 1
        else:
            if c not in "\r\n":
                emit(c)
            i += 1

    text = "".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip("\n")


def normalize_imported_text(text: str) -> str:
    text, _notes = normalize_line_endings(text or "")
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t\f\v]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


def safe_filename(name: str, fallback: str = "manuscript") -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name or fallback).strip("-._")
    return name or fallback
