# Changelog

## 2.0

Version 2.0 is an overhaul of the whole app: the bugs found in a full review are fixed, the server is hardened, the code is split into modules with a test suite behind it, and four feature areas are new (language-aware editing, projects with snapshots, an AI review workflow, and lists/tables/EPUB in the exports). `python app.py` is still the only start step.

### Things that behave differently from 1.2

- **The API key is no longer written to disk.** It stays in your browser (localStorage). A key that an older version saved in `manuscript_workbench_settings.json` is removed when the app starts; enter it again if the field is empty.
- **Every call to the app's API needs a session token**, and requests with a foreign `Host` or `Origin` are refused. This only matters for scripts you wrote yourself against the app; the page handles it by itself. Reload the page after restarting the app.
- **Remote images are blocked in the Markdown preview** by default (switch them on under `Book` → `Preview`).
- **Safe Cleanup no longer adds missing spaces after punctuation** (that step is previewed on its own now), and `--` to dash leaves `---` scene breaks and table separators alone.
- **Markdown lists and pipe tables become real Word lists and tables** in the DOCX export. If your dialogue lines start with `- `, switch this off under `Book` → `Export` (saved with the project).
- **A stopped or failed AI run no longer throws away what was finished.** The sections that were done can be applied and the run can be resumed.
- **Settings in the browser moved** from `vp.py.*` to `mwb.*` keys; old values are read and migrated automatically.
- The AI tab runs through one engine, so some status texts changed.

### Security

- Session token, Host/Origin allow-list, JSON content type required, `nosniff`/`no-store`/referrer headers and a strict Content-Security-Policy (`script-src 'self'; style-src 'self'`), so a web page in another tab can no longer read or change your settings.
- URL import: numeric host spellings (`127.1`, `2130706433`), hosts that resolve to a private address, and redirects to internal addresses are refused before any request is made.
- A confirmation before manuscript text is sent to an AI endpoint that is not on your own machine or network.
- The Markdown preview sanitizer keeps the text inside unknown tags, no longer lets a void tag swallow the rest of the preview, and still blocks scripts and active content.
- Projects use safe ids only, so nothing outside the projects folder can be read or written.

### Fixed

- Dutch apostrophes (`'s`, `'t`, `'k`, `'m`, `foto's`, `zo'n`) are no longer turned into opening quotes; a new `Repair apostrophes` fixes existing ones.
- A dropped AI connection no longer looks like a finished result; split `<think>` tags are stripped; Stop (or closing the tab) really stops the local model.
- Mojibake next to a non-breaking space is repaired in one pass.
- Invalid input gives a clear 400/413/415 instead of a 500.
- The Python and JavaScript chapter and page-number rules had drifted apart (`Part One: Arrival`, a bare `civil` read as a page number); they are one rule now, with shared test cases.
- The built-in prompts can no longer be "deleted" and come back.
- DOCX import no longer drops the text of hyperlinks.
- A form feed or other control code from a PDF no longer makes the DOCX export fail.
- A text that ends in a blank line no longer shows an empty paragraph in the AI Diff view.

### New

- **Language profiles (English, Dutch)**: quote style (standard or low-high), dash style, apostrophes, space before punctuation, a language suggestion from the text, and Dutch front/back matter (`proloog`, `bijlage`, `colofon`) as chapter candidates.
- **Chapter candidate manager** in the Markdown tab: mark as chapter or subhead, ignore (remembered, also by Preflight), or mark all in one undo step.
- **Fast on large manuscripts**: analysis in a Web Worker, a virtual line gutter without a line limit, typing stays cheap (measured with a synthetic 500,000-word manuscript).
- **Projects** (`.mwb.json`) with autosave to disk, a `.bak` of the previous version, conflict detection, export/import of a project file, and a projects folder you can move with `MANUSCRIPT_WORKBENCH_DATA_DIR`.
- **Snapshots**: manual and automatic (before AI apply, Replace All, loading a file, clearing, whole-text clean-ups, marking all chapters), compare against the text on screen, and restore (which keeps what it replaces).
- **AI review workflow**:
  - word-level **Diff** view with per-paragraph accept/reject;
  - a **glossary** (`term`, `term => translation`) that is added to the prompt, checked by the guardrails and flagged in the Diff view;
  - **resumable runs** with a status per section, Resume, Run this / Run from here / Redo, automatic retries, and Apply for the finished sections;
  - LM Studio model details (loaded state, context, quantization) and a suggested chunk size, with a plain fallback for every other provider;
  - clear provider error messages, and a `thinking... 12 s` status for reasoning models.
- **DOCX export of lists, tables and links** (nested lists, numbering that restarts per list, header rows that repeat, column alignment), and **DOCX import in document order** (tables, lists, hyperlinks; images and footnotes are reported as skipped).
- **EPUB export** (EPUB 3, chapters at `#` headings, table of contents, metadata from the Book tab).

### Under the hood

- The single 2,400-line `app.py` is now the package `manuscript_workbench/`; the frontend is `static/` with ES modules (DOM-free `core/` and DOM-bound `ui/`), no inline script or style, and no build step.
- A test suite: about 350 Python tests (pytest, with a mock OpenAI provider) and about 275 JavaScript tests (`node --test`), golden snapshots of the behaviour that must not change, and shared parity cases for the Python and JavaScript rules. `./scripts/check.sh` runs everything, including lint.
- The USER_GUIDE was corrected and extended, and a README layout and developer notes were added.
- Naming: internal `vellum*` names are gone; old saved settings and old DOCX style names are still understood.

### Known gaps

- Not tested against a real LM Studio or oMLX instance (the mock provider only); LM Studio's own model list is read leniently because its format differs between versions.
- The EPUB is checked for well-formedness and a consistent structure, but not with the official `epubcheck`; it has no images or cover.
- The editor is still a plain text area, which limits very large documents.
- A paused AI run is forgotten when the page is reloaded.

## 1.2

The single-file version this overhaul started from.
