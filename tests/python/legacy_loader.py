"""Loads the current single-file app.py as a module (the 'legacy' implementation).

Phase 0 tests exercise the original code through this loader. After the restructure
(phase 2) the same tests are pointed at the new package by changing only this file.
"""
from __future__ import annotations

import importlib.util
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_PATH = ROOT / "app.py"


def load_legacy_app():
    spec = importlib.util.spec_from_file_location("mw_legacy_app", APP_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["mw_legacy_app"] = module
    spec.loader.exec_module(module)
    return module
