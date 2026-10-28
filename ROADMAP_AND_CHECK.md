# Roadmap and Check Report

Status: version 2.0. See [CHANGELOG.md](CHANGELOG.md) for what the 2.0 overhaul changed.

## Current Product Shape

Manuscript Workbench is a Markdown-first, local-first manuscript tool:

- Local Python web app at `http://127.0.0.1:8765` (`python app.py`; the code is the package `manuscript_workbench/`, the frontend is `static/` with ES modules and no build step).
- TXT/MD/RTF/DOCX/HTML import, URL import, and a folder merge flow. DOCX import reads paragraphs, lists, tables and hyperlinks in document order.
- Markdown structure in the editor: `#`, `##`, `>`, `***`, lists, pipe tables, links and fenced blocks like `::: verse`.
- Preview pane rendered with Python-Markdown and a sanitizer.
- Diagnostics, Preflight, Outline, Clean, AI, Markdown (with the chapter candidate manager) and Book (metadata, glossary, export options) tabs.
- Language profiles for English and Dutch typography.
- Find/Replace with regex, case-sensitive mode, whole-text scope, and selection-only scope.
- Projects (`.mwb.json`) with autosave, conflict detection, and automatic and manual snapshots.
- AI rewrite, clean, guided rewrite and translate through LM Studio, oMLX, Ollama or another OpenAI-compatible endpoint: streaming preview, resumable section runs, a word-level Diff view with per-paragraph accept/reject, a glossary, and content guardrails.
- Export to TXT, Markdown, DOCX (Word styles, lists, tables, hyperlinks) and EPUB 3.
- Browser autosave and recovery for sessions without a project.

## Markdown to DOCX Mapping

| Markdown | DOCX style / result |
|---|---|
| `# Chapter` | `Heading 1` |
| `## Subhead` … `###### Subhead` | `Heading 2` … `Heading 6` |
| `> Quote` | block quote style |
| `***` | centered scene break `* * *` |
| `::: verse` | verse block style |
| `::: attribution` | attribution style |
| `::: centered` | centered paragraph style |
| `::: flush-left` | flush-left paragraph style |
| `::: written-note` | written note style |
| `::: text-conversation` | text conversation style |
| `::: caption` | caption style |
| `::: inline-image` | placeholder style for later image work |
| `- item`, `* item`, `+ item` | `List Bullet` (`List Bullet 2`, `3` when nested) |
| `1. item`, `1) item` | `List Number` (`2`, `3` when nested), numbering restarts per list |
| pipe table | Word table, `Table Grid`, bold repeating header row, column alignment |
| `[text](https://…)`, `mailto:` | Word hyperlink |

Lists can be switched off in the Book tab (dialogue lines that start with `- `); the switch also applies to the EPUB.

## Inline Mapping

| Markdown / marker | DOCX result |
|---|---|
| `*italic*` | italic run |
| `**bold**` | bold run |
| `***bold italic***` | bold + italic run |
| `` `code` `` | monospace character style |
| `[[u:text]]` | underline |
| `[[sc:text]]` | small caps character style |
| `[[mono:text]]` | monospace character style |
| `[[sans:text]]` | sans serif character style |

## EPUB

Every `#` heading starts a chapter file; text before the first one is front matter. A table of contents (`nav.xhtml` and `toc.ncx`) lists chapters with their `##` subheads; the Book tab supplies title, subtitle, author, language, publisher and series. Blocks, quotes, scene breaks, lists and tables are styled by a small stylesheet. Images and covers are not included.

## Known Limitations

- DOCX import is style-aware but not a full Word layout converter: images, footnotes/endnotes, text boxes and nested tables are skipped (the import note counts them).
- DOCX export of lists stops at three levels; table cells hold inline text only.
- RTF import extracts text only.
- The EPUB has no images or cover and has not been run through the official `epubcheck`.
- The editor is a plain text area; very large documents make every edit a little heavier, even though all analysis runs in a worker.
- A paused AI run is forgotten when the page reloads.
- Chunked AI rewrite can drift at chunk boundaries; review the Diff view and the guardrails before applying.
- Browser autosave uses localStorage and is not a substitute for a project or exported files.
- Not verified against a real LM Studio or oMLX instance: only the mock provider has been used. LM Studio's own model list is read leniently because its format differs between versions.

## Checks to Keep Running

`./scripts/check.sh` runs everything below (it needs `.venv` with `requirements-dev.txt`; `npm install` adds lint):

- Python syntax of every file.
- `pytest`: behaviour tests, golden snapshots, regression tests for every defect found in the review, project and snapshot tests, DOCX and EPUB export/import tests (including a round trip of the whole corpus), AI stream tests against the mock provider, security tests (token, Host/Origin, content type, SSRF, sanitizer).
- `node --check` of every frontend module, ESLint, and `node --test` for the DOM-free core modules (cleaning, diagnostics, language, analysis, chunking, guardrails, diff, glossary, run state, project format).
- Shared parity cases (`tests/fixtures/parity.json`) keep the Python and JavaScript chapter, page-number, language and apostrophe rules identical.

When a behaviour change is intended, regenerate the golden snapshots (`tests/tools/generate_golden_py.py`, `tests/tools/generate_golden_js.js`) and review the diff: it is the behaviour change.

Manual checks that no automated test covers:

- A smoke test against a real provider: `Detect Model`, `Test`, `Rewrite Selection` with a reasoning model, `Stop generation`, a chunked run that is stopped and resumed, and (LM Studio) the loaded-model details.
- Open an exported DOCX in Word (lists, tables, hyperlinks, heading styles) and an exported EPUB in a reader such as Apple Books, Calibre or Kobo; run `epubcheck` on it if you publish.
- The Windows start script (`start_windows.bat`); only the macOS/Linux script has been exercised.

## Highest-Value Next Work

1. Run the real-provider smoke test above and fix what differs from the mock (LM Studio and oMLX).
2. Images and a cover in the EPUB, images in the DOCX import and export, and an `epubcheck` run in the checks.
3. A virtual editor (or a chunked text view) for very large manuscripts.
4. Keep a paused AI run in the project so it survives a reload.
5. More language profiles (German, French) and footnote support in the DOCX import.
6. Compare two snapshots with each other, and search across snapshots.

## Notes

- Internal names and localStorage keys may still contain older compatibility identifiers where changing them would break existing saved settings (`vp.py.*` browser keys are migrated to `mwb.*`).
- Legacy DOCX style names from older exports (`Vellum ...`) are still recognized on import, but new exports use general `Manuscript ...` style names.
