#!/usr/bin/env python3
"""
Manuscript Workbench — local Python edition.

Run:
  pip install -r requirements.txt
  python app.py

Then open http://127.0.0.1:8765
"""
from manuscript_workbench.server import main

if __name__ == "__main__":
    raise SystemExit(main())
