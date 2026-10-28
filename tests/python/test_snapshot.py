"""Golden snapshot: pins the observable Python behaviour so refactors cannot change it silently.

To accept an intentional change: .venv/bin/python tests/tools/generate_golden_py.py  and review the git diff.
"""
from __future__ import annotations

import json

import pytest

from conftest import FIXTURES
from snapshot import compute_snapshot

GOLDEN_PATH = FIXTURES / "golden" / "py_snapshot.json"


@pytest.fixture(scope="module")
def current(mw, corpus):
    return json.loads(json.dumps(compute_snapshot(mw, corpus)))


@pytest.fixture(scope="module")
def golden():
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


SECTIONS = [
    "decode", "rtf", "preflight", "preprocess_markdown", "render_markdown", "sanitize", "html_to_text",
    "import_file", "docx_export", "docx_roundtrip", "is_blocked_import_host", "validate_import_url",
    "normalize_base_url", "parse_chapter_number", "safe_filename", "markdown_line_marker",
]


def test_golden_covers_all_sections(golden):
    assert sorted(golden) == sorted(SECTIONS)


@pytest.mark.parametrize("section", SECTIONS)
def test_snapshot_section(section, current, golden):
    assert current[section] == golden[section]
