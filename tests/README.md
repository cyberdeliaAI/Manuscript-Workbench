# Tests

The safety net for the overhaul. Run everything with:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # once
./scripts/check.sh
```

`check.sh` runs a Python syntax check, `pytest`, a `node --check` of the embedded script and `node --test`.
Node is only needed for the JavaScript tests.

## Layout

| Path | What it holds |
|---|---|
| `tests/python/` | pytest suites. `legacy_loader.py` is the single place that decides which implementation is under test. |
| `tests/js/` | `node:test` suites. `adapter.js` is the single place that loads the client-side functions. |
| `tests/fixtures/corpus.json` | Shared EN/NL sample texts used by both languages (built by `tests/tools/build_corpus.py`). |
| `tests/fixtures/golden/` | Golden snapshots of observable behaviour (`py_snapshot.json`, `js_snapshot.json`). |
| `tests/tools/` | Generators for the corpus and the golden files. |

## Three kinds of tests

1. **Behaviour tests** (`test_behaviour.py`, `behaviour.test.js`): readable assertions about what must keep working.
2. **Golden snapshots** (`test_snapshot.py`, `legacy_snapshot.test.js`): the output of every important function over the
   whole corpus. A refactor must not change them. When a change is *intended*, regenerate and review the diff:

   ```bash
   .venv/bin/python tests/tools/generate_golden_py.py
   node tests/tools/generate_golden_js.js
   git diff tests/fixtures/golden/
   ```

   The diff of the golden file is the behaviour change; it belongs in the same commit as the code change.
3. **Known-issue tests** (`test_known_issues.py`, `known_issues.test.js`): the desired behaviour for defects found in the
   2026-10-27 analysis. Python ones are `xfail(strict=True)` (an unexpected pass fails the run, so a fixed bug cannot keep its
   marker); JS ones are `todo`. Fixing a bug means deleting its marker.

## Mock provider

`tests/python/mock_openai.py` is a stdlib OpenAI-compatible server. The requested *model name* selects the scenario
(`normal`, `think`, `think-split`, `reasoning`, `length`, `abort`, `slow`, `error500`), so streaming code can be tested
without LM Studio or oMLX.

## Writing test sources

Invisible or ambiguous characters (NBSP, zero-width space, soft hyphen, form feed) are built with `chr()` /
`String.fromCharCode()` so they stay visible in the source, and the fixtures are written with `\uXXXX` escapes so they stay
visible in diffs.
