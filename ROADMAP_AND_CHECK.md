# Roadmap and Check Report

## Current Product Shape

Manuscript Workbench is now Markdown-first:

- Local Python web app at `http://127.0.0.1:8765`.
- TXT/MD/RTF/DOCX/HTML import.
- Folder merge flow for combining multiple manuscript files in a chosen order.
- Markdown structure in the editor: `#`, `##`, `>`, `***`, and fenced blocks like `::: verse`.
- Preview pane rendered with Python-Markdown.
- Diagnostics, Preflight, Outline, Clean, AI, Markdown, and Book tabs.
- Find/Replace with regex, case-sensitive mode, whole-text scope, and selection-only scope.
- DOCX export with general manuscript/Word styles.
- LM Studio rewrite/clean with streaming preview, stop generation, chunked mode, and content guardrails.
- Browser autosave/recovery.

## Current Markdown to DOCX Mapping

| Markdown | DOCX style / result |
|---|---|
| `# Chapter` | `Heading 1` |
| `## Subhead` | `Heading 2` |
| `### Subhead` | `Heading 3` |
| `#### Subhead` | `Heading 4` |
| `##### Subhead` | `Heading 5` |
| `###### Subhead` | `Heading 6` |
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

## Known Limitations

- DOCX import is style-aware but not a full Word layout converter.
- DOCX import skips tables.
- Markdown lists and tables preview correctly, but DOCX export currently keeps their Markdown syntax as literal text. Preflight warns about this.
- RTF import extracts text only.
- Complex nested inline formatting can still need manual cleanup.
- Chunked AI rewrite can drift at chunk boundaries; review the preview and guardrails before applying.
- Autosave uses browser localStorage and is not a substitute for exported files.

## Checks to Keep Running

- `python -m py_compile app.py`
- Embedded JavaScript syntax extraction/check.
- DOCX smoke tests for headings, quote, scene break, inline formatting, and special blocks.
- Markdown preview smoke tests for headings, lists, tables, code fences, scene breaks, and inline markers.
- Preflight smoke tests for unclosed blocks, list/table DOCX warnings, page numbers, and chapter candidates.

## Highest-Value Next Work

1. Chapter candidate manager: Mark / Ignore / Mark all.
2. Word-level diff in the AI preview.
3. Per-paragraph accept/reject after AI rewrite.
4. Save/Open project file (`.mwb.json`) with text, metadata, prompts, settings, and future glossary.
5. Basic tests for import/export/preflight/cleanup functions.
6. Better DOCX export for bullet/numbered lists.
7. Collapsible Outline tree.
8. Glossary / do-not-touch list injected into AI prompts and integrity checks.
9. Optional EPUB export.

## Notes

- Internal names and localStorage keys may still contain older compatibility identifiers where changing them would break existing saved settings.
- Legacy DOCX style names from older exports are still recognized on import, but new exports use general `Manuscript ...` style names.
