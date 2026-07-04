# Manuscript Workbench — User Guide

Manuscript Workbench is a local Python web app for manuscript cleanup, Markdown-based structure, AI rewrite/cleanup through local OpenAI-compatible providers, live preview, and export to TXT, Markdown, and DOCX.

Everything runs on your own computer. The only network traffic the app produces is:

- the local AI provider you configure yourself (LM Studio, oMLX, Ollama, or a custom endpoint);
- `Import URL`, which fetches exactly the page you ask for.

Nothing else leaves your machine. Your manuscript text is never sent to a cloud service by this app.

## Contents

1. [What Manuscript Workbench Does](#1-what-manuscript-workbench-does)
2. [Installation and Starting](#2-installation-and-starting)
3. [Interface Tour](#3-interface-tour)
4. [Opening Files](#4-opening-files)
5. [The Editor](#5-the-editor)
6. [Markdown Structure Reference](#6-markdown-structure-reference)
7. [Formatting Toolbars](#7-formatting-toolbars)
8. [Preview](#8-preview)
9. [Check Tab: Diagnostics and Preflight](#9-check-tab-diagnostics-and-preflight)
10. [Outline Tab](#10-outline-tab)
11. [Clean Tab](#11-clean-tab)
12. [AI Tab](#12-ai-tab)
13. [Markdown Tab](#13-markdown-tab)
14. [Book Tab: Metadata](#14-book-tab-metadata)
15. [Find / Replace](#15-find--replace)
16. [Selection Menu](#16-selection-menu)
17. [Exporting](#17-exporting)
18. [Autosave, Undo, and Local Storage](#18-autosave-undo-and-local-storage)
19. [Keyboard Shortcuts](#19-keyboard-shortcuts)
20. [Practical Workflows](#20-practical-workflows)
21. [Troubleshooting](#21-troubleshooting)
22. [Known Limitations](#22-known-limitations)
23. [Recommended Daily Workflow](#23-recommended-daily-workflow)

## 1. What Manuscript Workbench Does

Manuscript Workbench runs locally and normally opens at:

```text
http://127.0.0.1:8765
```

It is designed for:

- importing TXT, Markdown, RTF, DOCX, and HTML files;
- cleaning text copied from documents, PDFs, websites, or AI output;
- removing or repairing encoding artifacts, hidden characters, excess spaces, tabs, headers, footers, and HTML markup;
- adding manuscript structure with Markdown;
- previewing the rendered manuscript;
- rewriting, cleaning, translating, or reviewing text through LM Studio, oMLX, Ollama, or another OpenAI-compatible local endpoint;
- merging multiple files from a folder in a chosen order;
- exporting to TXT, Markdown, or DOCX with real Word paragraph styles.

The app is **Markdown-first**: structure lives in the text itself as `#` headings, `>` quotes, `***` scene breaks, and `::: name` blocks. That makes the manuscript readable, portable, diff-friendly, and usable in any other Markdown tool.

## 2. Installation and Starting

### Requirements

- Python 3.9 or newer (`python3 --version`).
- The packages in `requirements.txt`: `python-docx`, `requests`, `markdown`, `lxml`, `trafilatura`.
- A modern browser. Chrome, Edge, or Safari is recommended; `Merge Folder` uses the browser folder picker, which works best in Chromium-based browsers.

### macOS / Linux

Open Terminal in the project folder and run:

```bash
./start_mac_linux.sh
```

On first run, the script creates a `.venv` folder and installs the packages from `requirements.txt`. Later runs reuse that environment.

### Windows

Double-click or run:

```text
start_windows.bat
```

### Manual start

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Then open the URL printed in the terminal.

### Stopping the app

Press `Ctrl+C` in the terminal window that is running the app.

### Changing the port

The default port is `8765`. To use another port:

```bash
MANUSCRIPT_WORKBENCH_PORT=8766 ./start_mac_linux.sh
```

### If Port 8765 Is Already in Use

If you see:

```text
Port 8765 is already in use.
```

Manuscript Workbench is probably already running. Open `http://127.0.0.1:8765` in your browser.

To find and close the old process on macOS/Linux:

```bash
lsof -nP -iTCP:8765 -sTCP:LISTEN
kill <PID>
```

Replace `<PID>` with the number shown by `lsof`. Or simply start a second copy on another port, as shown above.

### Health check

`http://127.0.0.1:8765/api/health` returns a small JSON status that shows whether all Python packages were found. Useful when something behaves oddly after an update.

## 3. Interface Tour

From top to bottom:

- **Header bar** — filename display and the main file actions: `Load File`, `Import URL`, `Merge Folder`, `Undo`, `Clear`, `Export TXT`, `Export Markdown`, `Export DOCX`.
- **Recovery bar** — appears only when a previous autosave is found (see [section 18](#18-autosave-undo-and-local-storage)).
- **Stats bar** — live counts: characters, words, lines, chapters (`#` headings), subheads (`##`–`######` headings).
- **Quick formatting bar** — text style dropdown, inline formatting buttons (B, I, U, SC, Mono, Sans), `Find`, `Preview`, `AI`, `Clean`, `Clear`.
- **Markdown tools toolbar** — collapsible toolbar with every structure marker, special block, and inline style. Click `Expand` to open it.
- **Editor** — the large text area, with a line-number gutter on the left. Colored gutter stripes flag lines with issues (see [section 5](#5-the-editor)).
- **Editor footer** — the `Whole text` / `Selection only` scope toggle, the `Word wrap` checkbox, and selection info.
- **Sidebar** — six tabs: `Check`, `Outline`, `Clean`, `AI`, `Markdown`, `Book`.
- **Selection menu** — a small floating menu with quick actions that appears when you select text in the editor.

## 4. Opening Files

### Load File

Loads one file into the editor. Supported types:

| Type | How it is imported |
|---|---|
| `.txt` | Plain text with automatic encoding detection |
| `.md` / `.markdown` | Opened directly as Markdown |
| `.rtf` | Practical plain-text extraction (no formatting preserved) |
| `.docx` | Paragraph styles converted to Markdown where possible |
| `.html` / `.htm` | Extraction choice dialog (see below) |

Notes on each format:

- **Encoding detection.** Text files are read as UTF-8, UTF-16 (with or without BOM), or Windows-1252, whichever produces the cleanest result. A BOM is removed and line endings are normalized to LF. The toast message after loading tells you what was detected.
- **Content sniffing.** A file with the wrong extension is still recognized by its content: DOCX by its ZIP signature, RTF by `{\rtf`, HTML by its opening tags.
- **DOCX import** maps common Word paragraph styles back to Markdown: `Heading 1`–`Heading 6` become `#`–`######`, `Quote`/`Intense Quote`/manuscript block quote styles become `>`, ornamental lines (`* * *`, `---`) become `***` scene breaks, and manuscript block styles (verse, written note, attribution, and so on) become `::: name` blocks. Inline bold, italic, underline, small caps, monospace, and sans serif runs become Markdown/inline markers. Tables inside the DOCX are **skipped** (the import note tells you how many).
- **RTF import** extracts plain text, converting paragraph breaks, tabs, special dashes/quotes, and Unicode escapes. Formatting is not preserved.
- **`.doc` (old binary Word)** is not supported. Save it as `.docx`, `.rtf`, or `.txt` first — the app tells you this if you try.

> **Important:** loading a file replaces the current editor content. When the editor already holds text, the app asks for confirmation first. Note that the undo history is reset when a new file loads, so export unsaved work you care about first (Export Markdown is the safest snapshot).

### HTML import: Simple vs Main text

When you load an HTML file (or import a URL), a comparison dialog appears with two extraction results side by side:

- **Simple extraction** — a broad local extraction that keeps more of the page text but may include more clutter.
- **Main text extraction** — Trafilatura-based extraction that tries to isolate the central article/manuscript text and drop boilerplate. This is the default choice.

Both methods ignore scripts, styles, navigation, headers, footers, sidebars, forms, and hidden layout elements. Trafilatura is a local Python package; it does not use a cloud service.

Pick the version that preserves your text best. For unusual manuscript exports, simple extraction is often safer because it is less selective. This is practical extraction, not a full browser renderer — always check the imported text.

### Import URL

`Import URL` fetches a public `http`/`https` page and shows the same Simple/Main extraction choice before replacing the editor.

Built-in safety limits:

- only `http` and `https` URLs;
- localhost, private, and internal network addresses are blocked;
- URLs with embedded usernames/passwords are rejected;
- responses larger than 12 MB are refused;
- the fetch times out if the site is slow (about 8 s to connect, 25 s to read).

Some sites block automated fetches or load their article text with JavaScript; those pages may import incomplete text. In that case, save the page as HTML from your browser (`File → Save Page As`) and use `Load File` instead.

If the URL does not look like HTML at all, it is imported as plain text.

### Merge Folder

`Merge Folder` imports multiple files from a folder and joins them into one manuscript.

1. Click `Merge Folder` and choose a folder. All supported files in it (including subfolders) are picked up.
2. The files are imported one by one and listed in the merge window, initially in natural name order (`chapter-2` before `chapter-10`).
3. Arrange the order with `Up` and `Down`. Each row shows the character count and import notes.
4. Click `Merge into editor`. If the editor already holds text, the app asks for confirmation first.

Files are joined with a blank line between them. The result behaves like any other manuscript: check the `Outline`, fill in `Book` metadata, run `Preflight`, and export.

Tips:

- Name your files so the natural sort order is already correct (`01-prologue.md`, `02-chapter-one.md`, …); then you rarely need Up/Down.
- Keep old binary `.doc` files out of the folder — one unreadable file stops the import run, and you would have to reselect the folder after removing it.
- HTML files in a folder merge use main-text extraction automatically (no comparison dialog).

## 5. The Editor

The large text area on the left is the editor. It is a plain-text Markdown editor: what you see is exactly what is in your file.

### Stats bar

Above the editor: **chars**, **words**, **lines**, **chapters** (lines starting with a single `#`), **subheads** (lines starting with `##` through `######`). These update live as you type.

### Line gutter

The gutter shows line numbers with colored stripes for lines that need attention:

| Stripe color | Meaning |
|---|---|
| violet | encoding or hidden-character issue (mojibake, zero-width chars, special spaces, control chars, ligatures) |
| rust | spacing issue (trailing whitespace, tabs, extra blank lines) |
| amber | structure candidate (likely hard-wrapped line, page number, repeated header/footer) |
| blue | typography spacing (double spaces, space before punctuation) |
| amber (thin) | recognized Markdown structure line |

Hover a stripe to see a short description. On documents over 12,000 lines the gutter switches off for performance (the editor itself keeps working normally). The gutter is also hidden while `Word wrap` is on, because wrapped visual lines no longer match physical line numbers.

### Scope toggle

Below the editor:

- **Whole text** — Clean operations apply to the full document.
- **Selection only** — Clean operations apply only to the selected text.

This toggle affects the Clean tab and Safe Cleanup. AI actions have their own explicit scope buttons (Selection / Paragraph / Whole / Chunked).

### Word wrap

`Word wrap` wraps long lines visually instead of horizontal scrolling. It changes only the display, never the text.

### Tab indentation

Inside the editor:

- `Tab` with no selection inserts 4 spaces at the cursor;
- `Tab` with a selection indents all selected lines by 4 spaces;
- `Shift+Tab` removes one indentation level (a tab or up to 4 leading spaces) from the selected lines.

This is especially useful for nested Markdown lists.

## 6. Markdown Structure Reference

### Headings, quotes, and scene breaks

```markdown
# Chapter One

Regular manuscript text.

## A Subhead

> A quoted paragraph.

***
```

| Markdown | Meaning | DOCX style |
|---|---|---|
| `# Title` | chapter | Heading 1 |
| `# Part One` | part (auto-detected when the title starts with "Part" or "Deel") | Heading 1 |
| `## Title` | subheading | Heading 2 |
| `### Title` | lower subheading | Heading 3 |
| `#### Title` | 4th level | Heading 4 |
| `##### Title` | 5th level | Heading 5 |
| `###### Title` | 6th level | Heading 6 |
| `> text` | block quote | block quote style |
| `***` | scene break | centered `* * *` |

A scene break is recognized as a line of three or more `*`, `-`, or `~` characters (`***`, `---`, `~~~`, `* * *`). The app writes them as `***`; DOCX export renders them as a centered `* * *`.

### Special manuscript blocks

Extra structures use fenced blocks — a `::: name` line, the content, and a closing `:::` line:

```markdown
::: verse
A line of poetry
Another line
:::

::: written-note
A note written by a character.
:::
```

Available block types:

| Block | Use for | DOCX style |
|---|---|---|
| `verse` | poetry, lyrics, verse where line breaks matter | Manuscript Verse |
| `attribution` | quote attribution ("— Author") after a block quote | Manuscript Attribution |
| `centered` | a centered paragraph | Manuscript Centered Text |
| `flush-left` | a paragraph forced flush left | Manuscript Flush Left |
| `written-note` | a note written by a character | Manuscript Written Note |
| `text-conversation` | text messages / chat-style dialogue | Manuscript Text Conversation |
| `caption` | an image caption | Caption |
| `inline-image` | placeholder line for an image to insert later in Word | Manuscript Inline Image |
| `subtitle` | a chapter subtitle | Manuscript Element Subtitle |
| `element-author` | per-chapter author credit (anthologies) | Manuscript Element Author |
| `hidden-heading` | keep a title for structure/TOC while hiding it visually | Manuscript Hidden Heading |

Short aliases are accepted: `::: note` = `written-note`, `::: text` = `text-conversation`, `::: image` = `inline-image`.

Always close a block with a bare `:::` line — Preflight warns when a block appears unclosed.

### Inline markup

| Markup | Result in DOCX |
|---|---|
| `*italic*` | italic |
| `**bold**` | bold |
| `***bold italic***` | bold + italic |
| `` `code` `` | monospace character style |
| `[[u:text]]` | underline |
| `[[sc:text]]` | small caps character style |
| `[[mono:text]]` | monospace character style |
| `[[sans:text]]` | sans serif character style |

The `[[...]]` markers are the app's own lightweight notation for styles that plain Markdown cannot express. They round-trip through DOCX import/export.

## 7. Formatting Toolbars

### Quick formatting bar

Directly above the editor:

- **Text style** dropdown — marks the current line or selected lines as Normal text, Title/Chapter, Part, Heading 1–3, Quote block, Verse, or Written note. Choosing `Normal text` removes an existing marker without deleting the text.
- **B / I / U / SC / Mono / Sans** — wrap the selected text in the corresponding inline markup.
- **Find** — opens Find/Replace.
- **Preview** — toggles the rendered Markdown preview.
- **AI** / **Clean** — run AI Rewrite / AI Clean on the current selection.
- **Clear** — removes the structure marker from the current line.

### Markdown tools toolbar

Click `Expand` on the "Markdown tools" bar to open the full toolbar with three groups:

- **Structure** — Chapter, Part, Subhead 1–5, Subtitle, Element Author, Hidden Heading.
- **Special** — Quote, Verse, Attribution, Centered, Flush Left, Written Note, Text Conversation, Caption, Inline Image, plus `Ornament` and `Scene Break` insert buttons and `Clear Mark`.
- **Inline** — Italic, Bold, Underline, Small Caps, Monospace, Sans Serif.

Marking behavior:

- Prefix markers (`#`, `##`, `>`) are applied per line; existing markers on the same line are replaced, not stacked.
- Marking a line as **Part** automatically prefixes the title with "Part " when it does not already start with "Part" or "Deel".
- Block markers wrap the selected lines in `::: name … :::`.
- `Clear Mark` removes structure markers from the selected/current lines but keeps the text.

Every button has a tooltip that explains what the marker means in the exported book.

## 8. Preview

Click `Preview` in the quick bar to show a rendered Markdown preview beside the source text.

The preview supports headings, bold/italic, underline/small-caps/mono/sans markers, lists (including task lists), tables, links, images, quotes, code blocks, scene breaks, and the special `:::` blocks (shown as labeled panels).

Details worth knowing:

- Rendering is done by Python-Markdown on the local server, with a built-in JavaScript fallback if the server call fails, so the preview keeps working either way.
- The preview output is sanitized: only a safe set of tags and attributes is allowed, and only `http(s)`, `mailto:`, and relative links survive.
- Editor and preview scrolling are synchronized proportionally. On very large or complex documents the matched position may be approximate.
- The preview shows how the *Markdown* reads. DOCX export has its own mapping and limitations (notably lists and tables, see [section 17](#17-exporting)).

## 9. Check Tab: Diagnostics and Preflight

### Diagnostics

`Diagnostics` shows live counts of issues found in the text, with a `next` button that jumps to each occurrence in turn:

| Signal | What it means |
|---|---|
| Mojibake / encoding damage | UTF-8 text mis-read as Windows-1252 (`Ã©`, `â€™`, …) |
| Zero-width / invisible characters | zero-width spaces/joiners, soft hyphens, BOMs inside text |
| Non-breaking / special spaces | NBSP and other Unicode space variants |
| Control / page-break characters | control codes and form feeds from PDF/Word exports |
| Typographic ligatures | ﬁ ﬂ ﬀ and friends, often from PDF copy/paste |
| Likely hard-wrapped lines | lines that look like one paragraph broken mid-sentence |
| Standalone page-number lines | `17`, `- 17 -`, `page 17 of 200`, `pagina 17`, roman numerals |
| Repeated header/footer candidates | the same short line repeated throughout the document |
| Extra blank lines | runs of 3+ blank lines |
| Trailing whitespace | spaces/tabs at line ends |
| Tabs in the text | literal tab characters |
| Double spaces | two or more spaces inside a line |
| Space before punctuation | ` ,` ` .` ` !` and similar |
| Exact `--` instead of em dash | double hyphens |
| Three dots instead of ellipsis | `...` instead of `…` |
| Quotes counter | straight vs curly quote counts; flags mixed usage |

Each diagnostic has a matching Clean operation, so the Check tab doubles as a to-do list for the Clean tab.

### Preflight

`Preflight` checks for export risks. Run it before exporting an important DOCX. It reports:

- **missing title/author** — Book metadata is empty;
- **no chapters** — nothing is marked with `#` yet (error);
- **chapter candidates** — lines that look like chapter titles ("Chapter Seven", "Hoofdstuk 3", "Prologue", "Epilogue", "Part Two", front matter like "Copyright" or "About the author") but are not marked;
- **page numbers** — standalone page-number-like lines still present;
- **tabs** — literal tabs (Word imports are safer with styles instead of tabs);
- **trailing whitespace / extra blank runs**;
- **TOC detected** — "Contents"/"Inhoud" lines; most publishing tools generate their own table of contents;
- **empty markers** — structure markers without any text;
- **unclosed `:::` block** — an odd number of fence lines;
- **repeated lines** — short lines that repeat throughout the text (header/footer suspects);
- **chapter numbering sequence** — chapter numbers that skip or reset (works with digits, roman numerals, and English/Dutch number words);
- **lists / tables as literal text** — Markdown lists and tables preview correctly but are written as literal text in DOCX export;
- **invisible/control/mojibake characters** still present.

Each issue that has a location gets a `line N` button that jumps straight to it.

## 10. Outline Tab

`Outline` shows a clickable chapter navigator built from Markdown headings. Each row shows the title, line number, and word count of that section.

For chapter rows (`#` level) you can:

- **Go** — jump to the chapter;
- **AI** — select the chapter's text and start an AI rewrite;
- **Clean** — select the chapter's text and start an AI clean.

Chapter actions select the text from the chapter heading to the next heading of the same or higher level. Very long outlines show the first 120 headings.

## 11. Clean Tab

The Clean tab contains all non-AI cleanup operations. They respect the `Whole text` / `Selection only` scope toggle.

Operations that can change structure show a **before/after preview** first (`Apply change` confirms); simple character-level fixes apply directly. Every operation can be undone with the top-bar `Undo`.

### Safe Cleanup

`Safe Cleanup` runs a conservative, one-pass sequence that is safe for virtually any manuscript, in this order:

1. repair mojibake;
2. remove invisible/zero-width characters;
3. normalize special spaces to regular spaces;
4. strip control/page-break characters;
5. normalize Unicode composition (NFC);
6. replace typographic ligatures (ﬁ → fi);
7. convert tabs to spaces;
8. trim trailing spaces;
9. collapse multiple spaces;
10. remove space before punctuation;
11. add missing space after punctuation;
12. trim document edges.

It intentionally does **not** join lines, remove blank lines, delete page numbers, or change quotes/dashes — those are separate, previewed operations.

### Strip Markers Preview

Shows what the document looks like with all Markdown structure and inline markers removed — the same transformation used by `Export TXT`.

### Encoding & hidden characters

| Operation | What it does |
|---|---|
| Repair mojibake | decodes `Ã©`-style double-encoded sequences back to real characters |
| Remove zero-width / invisible chars | deletes zero-width spaces/joiners, word joiners, BOMs, soft hyphens |
| Normalize special spaces | converts NBSP and other Unicode spaces to plain spaces |
| Strip control / page-break chars | removes control codes and form feeds |
| Normalize Unicode composition | applies NFC so accented characters use single codepoints |
| Replace typographic ligatures | ﬁ ﬂ ﬀ ﬃ ﬄ ﬆ → plain letters |

### Structure (previewed)

| Operation | What it does |
|---|---|
| Extract text from HTML | strips HTML tags and boilerplate from pasted web content |
| Join wrapped lines conservatively | re-joins paragraphs that were hard-wrapped mid-sentence; skips headings, lists, scene breaks, indented and short lines. The checkbox below controls whether words split with a hyphen at line end are re-joined |
| Normalize blank lines | collapses runs of blank lines to a single blank line |
| Trim trailing spaces only | removes spaces/tabs at line ends |
| Remove indentation | strips leading spaces/tabs from every line |
| Remove standalone page-number lines | deletes lines that are only page numbers |
| Remove repeated header/footer candidates | deletes short lines that repeat many times across the document |

**Be careful** with structural cleanup on poetry, letters, scene breaks, and chapter titles: page numbers, roman-numeral chapter numbers, and centered titles can look alike. That is exactly why these operations always show a preview first.

### Spaces & tabs

Tabs to spaces · Collapse multiple spaces · Remove space before punctuation · Add missing space after punctuation.

### Typography (previewed)

| Operation | Notes |
|---|---|
| Quotes to curly | converts straight quotes to typographic quotes; handles leading apostrophes ('em, 'cause, '90s) |
| Quotes to straight | the reverse |
| `--` to em dash | converts `--` and `---` between words to `—`. Note: a line consisting only of `---` (a Markdown divider) is also converted — check the preview if you use `---` as a scene break; prefer `***` |
| `...` to ellipsis | converts three dots (also spaced `. . .`) to `…` |

### File

`Trim document edges` removes blank space at the very start and end of the document.

## 12. AI Tab

The AI tab connects to **local** OpenAI-compatible providers. Your text goes to the endpoint you configure and nowhere else.

### What is sent

Each request contains the model name, a system prompt (the selected preset), your text wrapped in an instruction, and `stream: true`. If you fill in any **Advanced request options** (temperature, top-p, top-k, repeat penalty, max tokens), those are included too; leave them empty to keep all runtime settings in the provider app.

### Provider setup

| Provider | Endpoint | Notes |
|---|---|---|
| LM Studio | `http://localhost:1234/v1` | easiest GUI option |
| oMLX | `http://localhost:8000/v1` | MLX models on Apple Silicon; may need an API key |
| Ollama | `http://localhost:11434/v1` | cross-platform |
| Custom | any OpenAI-compatible `/v1` endpoint | enter the base URL yourself |

Steps:

1. Start the provider and load/serve a model there.
2. Choose the provider in `Provider setup`. The endpoint fills in automatically (editing the endpoint switches the provider to Custom).
3. If the provider needs authentication, paste the key into `API Key`.
4. Click `Detect Model` and pick a model from the dropdown. `Test` checks the connection without changing anything.

If no model is selected, the app asks the provider for its model list and uses the first available model.

**LM Studio**: open LM Studio → load a model → start the Local Server → Detect Model here.

**oMLX**: start oMLX and its OpenAI-compatible server → choose oMLX here → paste the oMLX API key if required → Detect Model. If the oMLX log shows `GET /v1/models -> 401: API key required`, the endpoint is reachable but the key is missing or wrong.

**Ollama**: `ollama pull <model>` and make sure Ollama is running → Detect Model.

### Prompt presets

`Prompt preset` selects the system prompt used by the Rewrite actions:

| Preset | Character |
|---|---|
| Text Rewriter — balanced | general rewrite into cleaner, more readable prose; preserves meaning, structure, POV, tense |
| AI Cleanup — conservative | fixes typos, spacing, broken lines, OCR/mojibake damage without rewriting style |
| Light cleanup only | grammar/punctuation only, stays maximally close to the original wording |
| Humanize Rewrite — natural | removes stiff AI-sounding patterns, varies rhythm, supports English and Dutch |
| Strong prose polish | strongest stylistic rewrite that still preserves all content |
| Nederlands — clean herschrijven | Dutch-language rewrite into smooth modern Dutch |

The **AI Clean** buttons always use the conservative cleanup prompt, regardless of the selected preset. The **Rewrite** buttons use the selected preset.

In the **Prompt editor** section you can edit the active prompt (`Save Prompt`), create new presets (`Save As New`), delete presets, or `Reset Defaults`. Custom prompts are stored in your browser and survive restarts. Since AI Clean looks up the preset named "AI Cleanup — conservative", keep that name if you customize it.

### Rewrite strength

`Rewrite strength` (Prompt default / Light / Medium / Strong) adds a strength instruction to rewrite requests. It does not affect AI Clean.

### Rewrite & clean actions

| Action | Scope |
|---|---|
| Rewrite Selection / AI Clean Selection | the selected text |
| Current Paragraph / AI Clean Paragraph | the paragraph around the cursor (no selection needed) |
| Rewrite Whole / AI Clean Whole | the entire document in one request |
| Rewrite Chunked / AI Clean Chunked | the entire document in multiple sequential requests |

For long documents, always prefer the **Chunked** variants: a small provider context window can otherwise truncate or derail the output. Chunks split preferentially at chapter headings and blank lines, with the target size set by `Chunk size` (default 6000 characters, minimum 1200). Progress is shown per chunk.

### Guided tools

- **Improve Questions** — the AI asks clarification questions or lists improvement priorities for the selected text. Review-only; cannot be applied.
- **Feedback Only** — editorial feedback (clarity, flow, tone, structure, consistency) without a rewrite. Review-only.
- **Rewrite with Guidance** — rewrites the selection using your notes in `Goal / answers / context`.
- **Translate Selection** — translates the selection into the language in `Translate to`, preserving Markdown structure.

A productive loop: select a passage → `Improve Questions` → paste your answers into `Goal / answers / context` → `Rewrite with Guidance` → review and apply.

### The preview modal

Every AI action opens a before/after preview that streams the output live:

- `Split` / `After only` / `Before only` switch the layout (remembered between sessions);
- `auto-scroll` follows the generation; `Bottom` jumps to the end;
- `Stop generation` aborts; partial output stays visible but **cannot** be applied;
- `Apply change` replaces the original text with the result — nothing touches your manuscript until you click it;
- closing the modal keeps the result available behind the `Show Preview` button in the AI tab.

### Structure warnings and content guardrails

After generation the app compares the output with the input:

- **Structure warning** — Markdown structure markers (`#`, `##`, `>`, `***`, `:::`) changed position, order, or count. Example: `Structure changed position/order, but count stayed 8. Review before applying.`
- **Content guardrails** — a panel that flags large length changes, changed paragraph or dialogue-line counts, missing or newly appearing proper names, and missing numbers/dates.

These are review signals, not verdicts: they do not block applying and do not automatically mean the output is wrong. But when a warning appears, read the after-pane carefully before clicking `Apply change`.

Reasoning models that emit `<think>…</think>` blocks are handled automatically: the thinking is stripped from the output. Leading "Here is the rewritten text:" chatter and wrapping code fences are removed as well.

## 13. Markdown Tab

The Markdown tab summarizes the current structure:

- counts of chapters/parts, subheads, special blocks, and unmarked chapter **candidates**;
- a list of every structure item with a jump button (first 80 shown);
- candidate lines that look like chapters but are not marked yet, tagged `CHECK`.

Use it as a quick audit: every `CHECK` row is a line you probably want to mark as a chapter or deliberately leave as body text.

## 14. Book Tab: Metadata

The Book tab stores export metadata:

| Field | Where it ends up |
|---|---|
| Book Title | DOCX core property "title" |
| Subtitle | DOCX core property "subject" |
| Author | DOCX core property "author" |
| Language / Series / Book # / Publisher | DOCX keywords |
| Filename base | base name for all exported files |

Preflight warns when Title or Author is empty. Metadata is included in the autosave, so it survives restarts.

## 15. Find / Replace

Open with the `Find` button or `Cmd+F` (Mac) / `Ctrl+F` (Windows/Linux). If text is selected when you open it, short selections pre-fill the search field, and multi-line selections set the scope to `Selection only`.

Options:

- **Regex** — JavaScript regular expressions; capture groups work in the replacement (`$1`, `$2`);
- **Case sensitive**;
- **Scope** — whole text or the selection made before opening Find.

Buttons and keys:

- `Next` / `Previous` (or `Enter` / `Shift+Enter` in the search field) cycle through matches;
- `Replace` replaces the current match and moves on;
- `Replace All` replaces every match in scope and reports the count;
- `Escape` closes the window.

While Find is open, all matches are highlighted in the editor and the current match is selected and scrolled into view. The match count updates live as you type.

Use `Replace All` carefully, especially with regex — test on a selection first when in doubt. Replacements are one `Undo` step.

## 16. Selection Menu

When you select text in the editor, a small floating menu appears with a dropdown of quick actions:

- **AI**: AI Rewrite Selection, AI Clean Selection;
- **Inline**: Bold, Italic, Underline, Small Caps, Monospace, Sans Serif;
- **Markdown structure**: Chapter, Part, Subhead 1, Subhead 2, Quote, Verse, Written Note, Clear Structure Mark;
- **Clean**: Safe Cleanup Selection.

Pick an action and it runs immediately. The same actions are also available through the toolbars and sidebar; the menu just saves the trip.

## 17. Exporting

All exports use the `Filename base` from the Book tab (falling back to the loaded filename).

### Export TXT

Creates `<base>-clean.txt`: plain text with all Markdown structure characters and inline markers removed (headings keep their text, scene breaks become `* * *`). Use this when you want readable text only.

### Export Markdown

Creates `<base>-markdown.md`: the editor content exactly as it is. **This is the best archive and backup format** — it keeps all structure and can be re-opened here or in any Markdown tool.

### Export DOCX

Creates `<base>-formatted.docx`: a Word document where every Markdown structure becomes a real Word paragraph style, and inline markup becomes real character formatting (see the tables in [section 6](#6-markdown-structure-reference)).

Details:

- Book metadata is written into the document properties.
- Special manuscript blocks use clear named Word styles such as `Manuscript Verse`, `Manuscript Written Note`, and `Manuscript Block Quote`. In Word, you can restyle those centrally.
- **Known limitation:** Markdown lists and tables render in the preview but are written as literal `- item` / `| cell |` text in the DOCX. Preflight warns when your document contains them.

The DOCX round-trips: importing an exported DOCX back into the app restores the Markdown structure.

## 18. Autosave, Undo, and Local Storage

### Autosave

The app autosaves your text, metadata, and settings to the **browser's localStorage** shortly after every change. When you reopen the app and the editor is empty, a recovery bar offers:

- `Restore` — brings back the previous session (text, metadata, settings);
- `Discard` — deletes that autosave.

Limits to be aware of:

- localStorage belongs to one browser on one machine — a different browser or profile has its own autosave;
- browsers cap localStorage (typically 5–10 MB); on very large manuscripts the app warns when autosave fails;
- clearing browser site data deletes the autosave and your saved prompts/settings.

**Autosave is a safety net, not a saving system.** Export a Markdown file for anything you care about.

### Undo

The top-bar `Undo` reverts the last tool operation — cleanup, AI apply, structure marking, replace-all, merge, and so on — up to 20 steps, with cursor and scroll position restored. Normal typing is handled by the editor/browser itself (`Cmd/Ctrl+Z` inside the text area).

Note: loading a new file clears the undo history.

### What is stored in the browser

| Key | Contents |
|---|---|
| autosave | text, metadata, settings snapshot (without API key) |
| settings | UI state, provider, endpoint, model, **API key**, advanced options |
| prompts | your prompt presets |

The AI API key is kept in localStorage so you do not have to re-enter it. On a shared computer, clear site data for `127.0.0.1:8765` (or remove the key from the field) when you are done.

## 19. Keyboard Shortcuts

| Keys | Action |
|---|---|
| `Cmd+F` / `Ctrl+F` | open Find/Replace |
| `Escape` | close Find/Replace |
| `Enter` in Find field | next match |
| `Shift+Enter` in Find field | previous match |
| `Tab` | indent line/selection (4 spaces) |
| `Shift+Tab` | outdent line/selection |
| `Cmd+Z` / `Ctrl+Z` in editor | browser-level typing undo |
| `Enter` in URL field | fetch URL |

## 20. Practical Workflows

### Clean text from a PDF or messy paste

1. Paste the text into the editor.
2. Open the `Check` tab and look at Diagnostics.
3. Run `Safe Cleanup`.
4. Run `Join wrapped lines conservatively` and review the preview (PDF text is almost always hard-wrapped).
5. Run `Remove standalone page-number lines` and `Remove repeated header/footer candidates`, reviewing each preview.
6. Mark chapters, run `Preflight`, export.

### Clean text from an HTML file or URL

1. `Load File` (or `Import URL`) and compare `Simple` vs `Main text` extraction.
2. Choose the version that preserves the text best.
3. Run `Safe Cleanup`.
4. Mark chapters with `#` (the Markdown tab's `CHECK` rows show likely candidates).
5. Run `Preflight`, then export to Markdown or DOCX.

### Merge multiple files into one manuscript

1. `Merge Folder`, choose the folder, arrange the order.
2. `Merge into editor`.
3. Check the `Outline` — every file should contribute its chapters.
4. Fill in `Book` metadata.
5. `Preflight`, then `Export DOCX`.

### Rewrite a passage with AI

1. Select the passage.
2. AI tab: choose a prompt preset and rewrite strength.
3. `Rewrite Selection`.
4. Watch the stream; check the guardrails panel and any structure warning.
5. `Apply change` only when the after-pane is right.

### Improve a passage with questions first

1. Select the text and optionally describe the goal in `Goal / answers / context`.
2. `Improve Questions` → read the questions.
3. Add your answers to `Goal / answers / context`.
4. `Rewrite with Guidance` → review → apply.

### Translate a chapter

1. Open `Outline` and click the chapter's `Go`, then select it (or use the chapter `AI` button pattern: select via outline).
2. Set `Translate to` (e.g. `English`, `Dutch`, `German`).
3. `Translate Selection` → review → apply.

### Carefully clean a whole manuscript

1. **Export a Markdown backup first.**
2. Run `Safe Cleanup`.
3. Fix what Diagnostics still shows, using the previewed operations.
4. For AI cleanup of a long text, use `AI Clean Chunked`.
5. Review the preview and guardrails before applying.
6. Run `Preflight`, export.

## 21. Troubleshooting

**The browser shows "connection refused".** The Python app is not running. Start it with the start script and watch the terminal for errors.

**"Port 8765 is already in use."** The app is already running (open the URL), or another program owns the port — see [section 2](#2-installation-and-starting).

**"Missing dependencies" at startup.** Run `pip install -r requirements.txt` inside the `.venv` (the start scripts do this automatically).

**Detect Model fails / connection error.** The provider is not running, is on a different port, or the endpoint is wrong. Check that the endpoint ends in `/v1` and that the provider's own UI shows the server as started. Use `Test` to isolate connection problems from model problems.

**Provider returns 401.** The endpoint is reachable but needs an API key — paste it into `API Key`.

**AI output stops early or errors on long text.** The model's context window is too small for the request. Use `Rewrite Chunked` / `AI Clean Chunked`, or lower `Chunk size`.

**AI preview shows structure warnings on every run.** The model is rewriting your `#`/`>`/`:::` lines. Try a lower rewrite strength, a more conservative preset, or a better model; the warning system exists precisely to catch this before you apply.

**The Markdown preview looks different from the exported DOCX.** Expected for lists and tables (literal in DOCX) and for advanced Markdown that only the preview supports. The preview shows the Markdown; Preflight tells you which parts will not carry into DOCX.

**Text is full of `Ã©`-style characters after import.** Encoding damage from the source. Run `Repair mojibake` (also part of Safe Cleanup).

**The line-number gutter disappeared.** Word wrap is on, or the document exceeds 12,000 lines. Both are intentional.

**Autosave warning: "browser storage is full".** The manuscript is too large for localStorage. Export to disk; the app keeps working, only the crash-recovery net is unavailable at that size.

**A URL import comes back nearly empty.** The site probably renders its text with JavaScript. Save the page as HTML in your browser and use `Load File`.

## 22. Known Limitations

- AI quality depends entirely on the provider and model you run locally.
- A small provider context length can cause errors with large selections; chunked mode reduces this but chunk boundaries can still need review.
- DOCX export does not yet create true Word lists or tables from Markdown lists/tables (Preflight warns; the text is preserved literally).
- DOCX import is style-aware but not a full Word layout converter; tables in imported DOCX files are skipped.
- RTF import extracts plain text only.
- HTML/URL import is practical extraction, not a browser; JavaScript-heavy pages may import incompletely.
- Old binary `.doc` files are not supported — convert them first.
- Loading a file resets the undo history (the app asks for confirmation before replacing existing text).
- Autosave uses browser localStorage and is not a substitute for exported files.
- The app binds to `127.0.0.1` only: it is not reachable from other machines, by design.

## 23. Recommended Daily Workflow

1. Import text.
2. **Immediately export a Markdown backup.**
3. Run `Safe Cleanup`, then fix what Diagnostics still flags.
4. Add structure with `#`, `##`, `***`, and special blocks where needed; check the Markdown tab for `CHECK` candidates.
5. Use `Preview` to check the readable version.
6. Use AI on selections, paragraphs, or chunked text — review guardrails before every apply.
7. Run `Preflight`.
8. Export to Markdown (archive) and DOCX (delivery).
