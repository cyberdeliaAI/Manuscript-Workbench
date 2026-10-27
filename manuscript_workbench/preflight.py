"""Export preflight checks."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .structure import MARKDOWN_CONTAINER_RE, strip_structure_line, structure_marker_for_line


CHAPTER_CANDIDATE_RE = re.compile(
    r"^\s*(?:(?:chapter|hoofdstuk|chapitre|cap[ií]tulo)\s+([0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien)\b.*|(?:part|deel)\s+([0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien)\b.*|prologue|epilogue|acknowledg(?:e)?ments|about the author|copyright|dedication|preface|introduction|afterword|also by|inhoud|voorwoord|nawoord|dankwoord)\s*$",
    re.I,
)

PAGE_NUMBER_RE = re.compile(
    r"^\s*(?:[-—–]\s*)?(?:p\.?\s*|page\s+|pagina\s+)?(?:\d{1,4}|[ivxlcdm]{2,})(?:\s*(?:/|of|van)\s*\d{1,4})?(?:\s*[-—–])?\s*$",
    re.I,
)

ROMAN_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}

WORD_NUMS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20,
    "een": 1, "twee": 2, "drie": 3, "vier": 4, "vijf": 5, "zes": 6, "zeven": 7,
    "acht": 8, "negen": 9, "tien": 10,
}


def roman_to_int(s: str) -> Optional[int]:
    s = s.upper()
    if not s or any(ch not in ROMAN_VALUES for ch in s):
        return None
    total = 0
    prev = 0
    for ch in reversed(s):
        val = ROMAN_VALUES[ch]
        if val < prev:
            total -= val
        else:
            total += val
            prev = val
    return total if 0 < total < 5000 else None


def parse_chapter_number(line: str) -> Optional[int]:
    clean = strip_structure_line(line).strip()
    m = re.search(r"\b(?:chapter|hoofdstuk)\s+([0-9]+|[ivxlcdm]+|[A-Za-z]+)\b", clean, re.I)
    if not m:
        return None
    token = m.group(1).lower()
    if token.isdigit():
        return int(token)
    if token in WORD_NUMS:
        return WORD_NUMS[token]
    return roman_to_int(token)


def preflight(text: str, metadata: Dict[str, str]) -> Dict[str, Any]:
    lines = text.split("\n")
    issues: List[Dict[str, Any]] = []
    info: List[Dict[str, Any]] = []

    def add(level: str, code: str, message: str, count: int = 1, line: Optional[int] = None, sample: Optional[str] = None) -> None:
        issues.append({"level": level, "code": code, "message": message, "count": count, "line": line, "sample": sample})

    marked_chapters: List[Tuple[int, str]] = []
    subheads = 0
    special = 0
    candidates: List[Tuple[int, str]] = []
    page_nums: List[Tuple[int, str]] = []
    tabs = 0
    trailing = 0
    extra_blank_runs = 0
    blank_run_len = 0
    repeated: Dict[str, List[int]] = {}
    title_toc_lines: List[Tuple[int, str]] = []
    empty_markers: List[Tuple[int, str]] = []
    block_fence_lines: List[int] = []

    for idx, line in enumerate(lines, start=1):
        container = MARKDOWN_CONTAINER_RE.match(line)
        if container:
            block_fence_lines.append(idx)
            continue
        marker, content = structure_marker_for_line(line)
        content = content.strip()
        if marker in ("chapter", "part"):
            marked_chapters.append((idx, content))
        elif marker.startswith("subhead"):
            subheads += 1
        elif marker:
            special += 1
        if marker and not content and marker not in ("scene", "ornament"):
            empty_markers.append((idx, marker))
        if not marker and CHAPTER_CANDIDATE_RE.match(line.strip()):
            candidates.append((idx, line.strip()))
        if PAGE_NUMBER_RE.match(line.strip()) and not marker and line.strip():
            page_nums.append((idx, line.strip()))
        tabs += line.count("\t")
        if re.search(r"[ \t]+$", line):
            trailing += 1
        if line.strip() == "":
            blank_run_len += 1
        else:
            if blank_run_len >= 3:
                extra_blank_runs += 1
            blank_run_len = 0
        low = line.strip().lower()
        if low in ("contents", "table of contents", "inhoud", "toc"):
            title_toc_lines.append((idx, line.strip()))
        if 4 <= len(line.strip()) <= 90 and not marker and not PAGE_NUMBER_RE.match(line.strip()):
            repeated.setdefault(re.sub(r"\s+", " ", line.strip()), []).append(idx)
    if blank_run_len >= 3:
        extra_blank_runs += 1

    docx_list_lines: List[Tuple[int, str]] = []
    table_blocks: List[Tuple[int, str]] = []
    table_separator_re = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$")
    for idx, line in enumerate(lines, start=1):
        marker, _content = structure_marker_for_line(line)
        if marker:
            continue
        if re.match(r"^\s*(?:[-+*]|\d+[.)])\s+\S", line):
            docx_list_lines.append((idx, line.strip()))
        if idx < len(lines) and "|" in line and table_separator_re.match(lines[idx]):
            table_blocks.append((idx, line.strip()))

    if not metadata.get("title"):
        add("warning", "missing-title", "Book title metadata is empty.")
    if not metadata.get("author"):
        add("warning", "missing-author", "Author metadata is empty.")
    if not marked_chapters:
        add("error", "no-chapters", "No chapters/parts are marked with Markdown # headings.")
    else:
        info.append({"label": "Markdown chapters/parts", "value": len(marked_chapters)})
    if subheads:
        info.append({"label": "Markdown subheads", "value": subheads})
    if special:
        info.append({"label": "Special structure blocks", "value": special})
    if candidates:
        add("warning", "chapter-candidates", "Possible chapter/front-matter lines are not marked.", len(candidates), candidates[0][0], candidates[0][1])
    if page_nums:
        add("warning", "page-numbers", "Standalone page-number-like lines are still present.", len(page_nums), page_nums[0][0], page_nums[0][1])
    if tabs:
        add("warning", "tabs", "Tabs are still present. DOCX imports are safer with styles instead of tabs.", tabs)
    if trailing:
        add("info", "trailing-whitespace", "Lines with trailing whitespace found.", trailing)
    if extra_blank_runs:
        add("warning", "extra-blank-runs", "Runs of 3+ blank lines found.", extra_blank_runs)
    if title_toc_lines:
        add("warning", "toc-detected", "Possible table of contents/title-page content detected. Most publishing/export tools create their own TOC.", len(title_toc_lines), title_toc_lines[0][0], title_toc_lines[0][1])
    if empty_markers:
        add("warning", "empty-markers", "Structure markers without text found.", len(empty_markers), empty_markers[0][0], empty_markers[0][1])
    if len(block_fence_lines) % 2:
        add("warning", "unclosed-structure-block", "A ::: structure block appears to be unclosed.", 1, block_fence_lines[-1], ":::")
    if docx_list_lines:
        add("warning", "docx-list-literal", "Markdown lists preview nicely, but DOCX export currently keeps list markers as literal text.", len(docx_list_lines), docx_list_lines[0][0], docx_list_lines[0][1])
    if table_blocks:
        add("warning", "docx-table-literal", "Markdown tables preview nicely, but DOCX export currently keeps table syntax as literal text.", len(table_blocks), table_blocks[0][0], table_blocks[0][1])

    repeated_candidates = [(k, v) for k, v in repeated.items() if len(v) >= 4 and v[-1] - v[0] >= 40]
    if repeated_candidates:
        repeated_candidates.sort(key=lambda kv: len(kv[1]), reverse=True)
        sample, positions = repeated_candidates[0]
        add("warning", "repeated-lines", "Repeated short lines may be headers/footers.", len(repeated_candidates), positions[0], sample)

    chapter_nums = [(line_no, parse_chapter_number(line)) for line_no, line in marked_chapters]
    chapter_nums = [(ln, num) for ln, num in chapter_nums if num is not None]
    if len(chapter_nums) >= 3:
        skips = []
        nums = [n for _, n in chapter_nums]
        for a, b in zip(nums, nums[1:]):
            if b != a + 1:
                skips.append((a, b))
        if skips:
            a, b = skips[0]
            add("warning", "chapter-number-sequence", f"Chapter numbering may skip or reset: {a} → {b}.", len(skips))

    invisible_count = len(re.findall(r"[\u200B\u200C\u200D\u2060\uFEFF\u00AD]", text))
    if invisible_count:
        add("warning", "invisible-chars", "Invisible/zero-width characters found.", invisible_count)
    control_count = len(re.findall(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]", text))
    if control_count:
        add("warning", "control-chars", "Control/page-break characters found.", control_count)
    mojibake_count = len(re.findall(r"[\u00C2-\u00F4][\u0080-\u00BF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]", text))
    if mojibake_count:
        add("warning", "mojibake", "Possible mojibake/encoding damage found.", mojibake_count)

    levels = {"error": 0, "warning": 0, "info": 0}
    for issue in issues:
        levels[issue["level"]] = levels.get(issue["level"], 0) + 1
    return {"issues": issues, "summary": levels, "info": info, "lineCount": len(lines), "wordCount": len(re.findall(r"\S+", text))}
