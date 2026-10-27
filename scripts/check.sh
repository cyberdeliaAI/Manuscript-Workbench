#!/usr/bin/env bash
# Runs the whole safety net: Python syntax, Python tests, JS syntax and JS tests.
# Usage: ./scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PY=".venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "No .venv found. Run: python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt" >&2
  exit 2
fi

echo "== python: syntax"
"$PY" -B -c "import ast,sys,pathlib; [ast.parse(p.read_text(encoding='utf-8'), str(p)) for p in pathlib.Path('.').rglob('*.py') if '.venv' not in p.parts]; print('ok')"

echo "== python: tests"
"$PY" -m pytest -q

if command -v node >/dev/null 2>&1; then
  echo "== javascript: syntax"
  for f in static/js/*.js; do node --check "$f"; done && echo ok
  echo "== javascript: tests"
  node --test tests/js/
else
  echo "== javascript: node not found, skipping JS checks" >&2
fi
echo "== all checks passed"
