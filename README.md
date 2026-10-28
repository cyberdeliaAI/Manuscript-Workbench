# Manuscript Workbench — Python edition

Local web app for cleaning manuscripts, structuring text with Markdown, importing files or URLs, exporting TXT/Markdown/DOCX, running preflight checks, and streaming rewrite/clean tasks through local OpenAI-compatible providers such as LM Studio and oMLX.

User guide: [USER_GUIDE.md](USER_GUIDE.md)

## Screenshot

![Manuscript Workbench screenshot](screenshot/screenshot01.png)

## Install

```bash
cd "Manuscript Workbench"
python -m venv .venv
# macOS/Linux
source .venv/bin/activate
# Windows PowerShell
# .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open the URL printed in the terminal, normally:

```text
http://127.0.0.1:8765
```

To use another port:

```bash
MANUSCRIPT_WORKBENCH_PORT=8766 ./start_mac_linux.sh
```

## Local AI Providers

The AI tab supports OpenAI-compatible local endpoints:

- LM Studio: `http://localhost:1234/v1`
- oMLX: `http://localhost:8000/v1`
- Ollama: `http://localhost:11434/v1`
- Custom OpenAI-compatible endpoint

Start your provider, choose it in the AI tab, click **Detect Model**, then choose the model.

The app sends `model`, `messages`, and `stream`. Runtime settings such as temperature/top-p/context length stay in the provider app, unless you fill in the optional Advanced request options in the AI tab.

## Markdown Structure

Markdown structure is converted to Word paragraph styles during DOCX export:

```markdown
# Chapter One          -> Heading 1
## A Subhead           -> Heading 2
### Lower Subhead      -> Heading 3
> Quoted paragraph     -> block quote
***                    -> scene break
```

Extra manuscript blocks use fenced Markdown-style containers:

```markdown
::: verse
Poetry or song lines
:::

::: written-note
A note written by a character
:::
```

Inline markup:

```markdown
*italic*
**bold**
`monospace`
[[u:underline]]
[[sc:small caps]]
[[sans:sans serif]]
```

## Saving Text

Use **Export TXT** for clean plain text without Markdown structure characters.

Use **Export Markdown** to keep the editable Markdown manuscript.

Use **Export DOCX** for a formatted Word document.

Use **Save project as…** (in the `☰ Menu`) to keep the manuscript with its book details, ignored chapter candidates and
prompts on disk. Projects autosave, keep a `.bak` of the previous version, and have snapshots that are taken before AI
applies, Replace All, imports and large clean-ups. They live in `projects/` next to the app (gitignored); set
`MANUSCRIPT_WORKBENCH_DATA_DIR` to store them elsewhere.

## Project layout

```text
app.py                      thin launcher (python app.py)
manuscript_workbench/       the Python backend
  server.py                   HTTP server, request handler, static files
  http_util.py  settings.py   responses and security headers, persisted settings
  importers.py  docx_import.py  htmlimport.py  textio.py   file and URL import
  netsafe.py                  safe URL fetching for Import URL
  mdrender.py  structure.py   Markdown preview (sanitizer) and structure vocabulary
  docx_export.py  preflight.py  export and preflight checks
  ai.py                       helpers for OpenAI-compatible providers
  project.py                  project files (.mwb.json), snapshots, atomic writes
static/                     the frontend (served from /static/, no build step)
  index.html  css/app.css
  js/main.js                  entry point (ES modules)
  js/core/                    pure logic: cleaning, diagnostics, language profiles, analysis, chunking, guardrails, project file format, word diff and review hunks, glossary (no DOM, unit-tested)
  js/workers/                 the analysis Web Worker (runs core/analysis.js off the main thread)
  js/ui/                      DOM-bound modules, one per feature (project.js / project-ui.js: projects and snapshots; ai-review.js: accept or reject AI changes)
tests/                      pytest + node:test suites (see tests/README.md)
```

## Development

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # once
npm install                                                              # optional: lint and formatting
./scripts/check.sh                                                       # syntax, tests, lint
```

The app needs no npm packages. Node (22.12 or newer) is only used for the JavaScript tests, `npm run lint` and
`npm run format`.

## Notes

- `.md` / `.markdown` import opens Markdown directly.
- `.docx` import preserves common paragraph styles as Markdown where possible, but it is not a full Word layout converter.
- `.rtf` import is a practical plain-text extraction, not full formatting preservation.
- `.html` / `.htm` import offers simple extraction and Trafilatura main-text extraction before loading.
- **Import URL** fetches an `http`/`https` page and shows the same extraction choice before replacing the editor.
- Old binary `.doc` files should be saved as `.docx`, `.rtf`, or `.txt` first.
