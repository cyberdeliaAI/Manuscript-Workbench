"""Export preflight checks."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .structure import MARKDOWN_CONTAINER_RE, is_table_start, list_item, strip_structure_line, structure_marker_for_line


CHAPTER_CANDIDATE_RE = re.compile(
    r"^\s*(?:(?:chapter|hoofdstuk|chapitre|cap[ií]tulo)\s+([0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\b.*|(?:part|deel)\s+([0-9ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien)\b.*|prologue|epilogue|acknowledg(?:e)?ments|about the author|copyright|dedication|preface|introduction|afterword|also by|inhoud|voorwoord|nawoord|dankwoord|proloog|epiloog|colofon|inhoudsopgave|over de auteur|over de schrijver|ook van|(?:appendix|bijlage)(?:\s+(?:[0-9]+|[a-z]|[ivxlcdm]+))?)\s*$",
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
    "acht": 8, "negen": 9, "tien": 10, "elf": 11, "twaalf": 12,
}

ROMAN_ONLY_RE = re.compile(r"^[ivxlcdm]{2,}$", re.I)


def normalize_language(value: Any) -> str:
    """'English', 'en-GB' -> 'en'; 'Nederlands', 'nl-BE' -> 'nl'; anything else -> 'other'; empty -> ''.
    static/js/core/language.js has the same rule."""
    v = str(value or "").strip().lower()
    if not v:
        return ""
    if v in ("en", "eng", "english", "engels") or re.match(r"^en[-_]", v):
        return "en"
    if v in ("nl", "nld", "dut", "dutch", "nederlands", "vlaams") or re.match(r"^nl[-_]", v):
        return "nl"
    return "other"


# An opening single quote that is really an apostrophe: English ('em, 'cause, 'tis, '90s) and Dutch ('s avonds,
# 't huis, 'n, 'k, 'm, 'r) elisions. static/js/core/language.js has the same rules.
_OPENER = r"(?:^|(?<=[\s(\[{—–-]))"
_DECADE_RULE = re.compile(_OPENER + "‘" + r"(?=\d{2}s\b)")
_ELISION_RULES = [
    re.compile(_OPENER + "‘" + r"(?=(?i:em|cause|til|tis|twas|n|round|bout|fore|gain|neath|cross)\b)"),
    _DECADE_RULE,
    re.compile(_OPENER + "‘" + r"(?=[stmkr]\b)"),
]


def count_wrong_apostrophes(text: str, language: Any = "") -> int:
    rules = _ELISION_RULES if normalize_language(language) != "other" else [_DECADE_RULE]
    return sum(len(rule.findall(text)) for rule in rules)


def candidate_key(text: Any) -> str:
    """Identifies a chapter candidate regardless of case and spacing. static/js/core/candidates.js has the same rule."""
    return " ".join(str(text or "").split()).lower()


def is_chapter_candidate(line: str) -> bool:
    """A line that looks like a chapter or front/back-matter title. static/js/core/structure.js has the same rule."""
    return bool(CHAPTER_CANDIDATE_RE.match(line.strip()))


def is_page_number_line(lines: List[str], index: int) -> bool:
    """A standalone page number such as `12`, `- 13 -` or `Page 14 of 200`.

    A bare roman numeral ("iv") is only a page number on a line of its own: "civil" or "mild" in a paragraph are words.
    static/js/core/line-heuristics.js has the same rule.
    """
    text = lines[index].strip()
    if not text or not PAGE_NUMBER_RE.match(text):
        return False
    if ROMAN_ONLY_RE.match(text):
        before_blank = index == 0 or not lines[index - 1].strip()
        after_blank = index == len(lines) - 1 or not lines[index + 1].strip()
        return before_blank and after_blank
    return True


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


def preflight(text: str, metadata: Dict[str, str], ignored_candidates: Optional[List[str]] = None) -> Dict[str, Any]:
    lines = text.split("\n")
    ignored = {candidate_key(k) for k in (ignored_candidates or []) if isinstance(k, str)}
    language = normalize_language(metadata.get("language"))
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
        if not marker and is_chapter_candidate(line) and candidate_key(line) not in ignored:
            candidates.append((idx, line.strip()))
        if not marker and is_page_number_line(lines, idx - 1):
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
        if 4 <= len(line.strip()) <= 90 and not marker and not is_page_number_line(lines, idx - 1):
            repeated.setdefault(re.sub(r"\s+", " ", line.strip()), []).append(idx)
    if blank_run_len >= 3:
        extra_blank_runs += 1

    list_items = 0
    tables = 0
    for idx, line in enumerate(lines, start=1):
        marker, _content = structure_marker_for_line(line)
        if marker:
            continue
        if list_item(line):
            list_items += 1
        if is_table_start(lines, idx - 1):
            tables += 1

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
    if list_items:
        info.append({"label": "Markdown list items", "value": list_items})
    if tables:
        info.append({"label": "Markdown tables", "value": tables})

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

    straight_quotes = text.count('"')
    typographic_quotes = sum(text.count(ch) for ch in "“”„")
    if straight_quotes and typographic_quotes:
        add("warning", "mixed-quotes", f"Straight and typographic double quotes are mixed ({straight_quotes} straight, {typographic_quotes} typographic).", min(straight_quotes, typographic_quotes))
    elif straight_quotes >= 10:
        add("info", "straight-quotes", "The text uses straight quotes. Clean > Quotes to curly converts them.", straight_quotes)
    wrong_apostrophes = count_wrong_apostrophes(text, language)
    if wrong_apostrophes:
        add("warning", "wrong-apostrophe", "An opening quote is used as an apostrophe (‘t huis instead of ’t huis). Clean > Repair apostrophes fixes this.", wrong_apostrophes)
    if language:
        info.append({"label": "Language profile", "value": language})

    levels = {"error": 0, "warning": 0, "info": 0}
    for issue in issues:
        levels[issue["level"]] = levels.get(issue["level"], 0) + 1
    return {"issues": issues, "summary": levels, "info": info, "lineCount": len(lines), "wordCount": len(re.findall(r"\S+", text))}
