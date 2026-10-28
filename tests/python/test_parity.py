"""The editor (JavaScript) and preflight (Python) implement the same rules twice. These shared cases keep them identical.

The same file is read by tests/js/parity.test.js.
"""
from __future__ import annotations

import json

import pytest

from conftest import FIXTURES

CASES = json.loads((FIXTURES / "parity.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("line,marker,content", CASES["line_markers"])
def test_markdown_line_marker(mw, line, marker, content):
    got_marker, got_content = mw.markdown_line_marker(line)
    assert got_marker == marker
    if marker:
        assert got_content == content


@pytest.mark.parametrize("line,expected", CASES["chapter_candidates"])
def test_chapter_candidate(mw, line, expected):
    assert mw.is_chapter_candidate(line) is expected


@pytest.mark.parametrize("case", CASES["page_numbers"], ids=lambda c: "|".join(c["lines"])[:40] + f"@{c['index']}")
def test_page_number_line(mw, case):
    assert mw.is_page_number_line(case["lines"], case["index"]) is case["expected"]


@pytest.mark.parametrize("value,expected", CASES["languages"])
def test_normalize_language(mw, value, expected):
    assert mw.normalize_language(value) == expected


@pytest.mark.parametrize("text,language,expected", CASES["apostrophes"])
def test_wrong_apostrophes(mw, text, language, expected):
    assert mw.count_wrong_apostrophes(text, language) == expected


@pytest.mark.parametrize("text,expected", CASES["candidate_keys"])
def test_candidate_key(mw, text, expected):
    assert mw.candidate_key(text) == expected
