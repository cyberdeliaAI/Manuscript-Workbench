"""Application constants."""
from __future__ import annotations

import os
from pathlib import Path

APP_HOST = "127.0.0.1"
APP_PORT = int(os.environ.get("MANUSCRIPT_WORKBENCH_PORT") or os.environ.get("VELLUM_PREP_PORT", "8765"))
APP_NAME = "Manuscript Workbench — Python"
APP_VERSION = "1.2"

ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "static"
INDEX_PATH = STATIC_DIR / "index.html"
USER_GUIDE_PATH = ROOT_DIR / "USER_GUIDE.md"

# Projects (.mwb.json) and their snapshots live in <data dir>/projects. The data dir is next to the app unless
# MANUSCRIPT_WORKBENCH_DATA_DIR says otherwise.
DATA_DIR = Path(os.environ.get("MANUSCRIPT_WORKBENCH_DATA_DIR") or ROOT_DIR).expanduser()
PROJECTS_DIR = DATA_DIR / "projects"

MAX_JSON_BYTES = 80 * 1024 * 1024
MAX_URL_IMPORT_BYTES = 12 * 1024 * 1024
MAX_IMPORT_REDIRECTS = 5

# Settings that must never be written to disk by the server (the browser keeps them in localStorage).
SECRET_SETTING_KEYS = ("lmApiKey",)
