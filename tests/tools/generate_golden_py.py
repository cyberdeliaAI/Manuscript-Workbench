#!/usr/bin/env python3
"""Regenerates tests/fixtures/golden/py_snapshot.json from the implementation under test.

Run:  .venv/bin/python tests/tools/generate_golden_py.py
Then review `git diff tests/fixtures/golden/py_snapshot.json`: every change is a behaviour change.
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests" / "python"))

from implementation import load_implementation  # noqa: E402
from snapshot import compute_snapshot  # noqa: E402


def main() -> None:
    corpus = json.loads((ROOT / "tests" / "fixtures" / "corpus.json").read_text(encoding="utf-8"))
    snap = compute_snapshot(load_implementation(), corpus)
    out = ROOT / "tests" / "fixtures" / "golden" / "py_snapshot.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, ensure_ascii=True, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
