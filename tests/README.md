# Tests

The safety net for the overhaul. Run everything with:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # once
./scripts/check.sh
```

`check.sh` runs a Python syntax check, `pytest`, a `node --check` of every frontend module, ESLint (when `npm install` was run) and `node --test`.
Node (22.12 or newer) is only needed for the JavaScript tests and lint.

## Layout

| Path | What it holds |
|---|---|
| `tests/python/` | pytest suites. `implementation.py` is the single place that decides which implementation is under test (a flat facade over the `manuscript_workbench` package). |
| `tests/js/` | `node:test` suites. `adapter.js` loads the pure modules in `static/js/core/` (via `require()` of ES modules) as one flat object. |
| `tests/fixtures/corpus.json` | Shared EN/NL sample texts used by both languages (built by `tests/tools/build_corpus.py`). |
| `tests/fixtures/golden/` | Golden snapshots of observable behaviour (`py_snapshot.json`, `js_snapshot.json`). |
| `tests/tools/` | Generators for the corpus and the golden files. |

## Three kinds of tests

1. **Behaviour tests** (`test_behaviour.py`, `behaviour.test.js`): readable assertions about what must keep working.
2. **Golden snapshots** (`test_snapshot.py`, `snapshot.test.js`): the output of every important function over the
   whole corpus. A refactor must not change them. When a change is *intended*, regenerate and review the diff:

   ```bash
   .venv/bin/python tests/tools/generate_golden_py.py
   node tests/tools/generate_golden_js.js
   git diff tests/fixtures/golden/
   ```

   The diff of the golden file is the behaviour change; it belongs in the same commit as the code change.
3. **Regression tests** (`test_regressions.py`, `test_ai_stream.py`, `regressions.test.js`): one test per defect found in the
   2026-10-27 analysis (security hardening, sanitizer, SSRF, typography, AI stream). While a defect was open its test was
   written as a strict `xfail` / `todo`; once fixed the marker was removed and the test is now an ordinary guard.

Feature suites sit next to these: `test_project.py` / `project.test.js` cover project files and snapshots (atomic writes,
conflict detection, retention, path safety, the HTTP routes and the project file format).

## Mock provider

`tests/python/mock_openai.py` is a stdlib OpenAI-compatible server. The requested *model name* selects the scenario
(`normal`, `think`, `think-split`, `reasoning`, `length`, `abort`, `slow`, `error500`), so streaming code can be tested
without LM Studio or oMLX.

## Writing test sources

Invisible or ambiguous characters (NBSP, zero-width space, soft hyphen, form feed) are built with `chr()` /
`String.fromCharCode()` so they stay visible in the source, and the fixtures are written with `\uXXXX` escapes so they stay
visible in diffs.
