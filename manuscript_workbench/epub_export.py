"""Markdown to EPUB 3 export (standard library only: an EPUB is a zip of XHTML files).

The manuscript is read line by line exactly like the DOCX export does, so both give the same paragraphs: every line
of text is a paragraph, `#` headings start a new chapter file, and the same structure markers, lists and tables are
understood. Images are not embedded.
"""
from __future__ import annotations

import datetime as _dt
import io
import re
import uuid
import zipfile
from typing import Any, Dict, List, Optional, Tuple
from xml.sax.saxutils import escape, quoteattr

from .docx_export import INLINE_TOKEN_RE
from .preflight import normalize_language
from .structure import (
    MARKDOWN_CONTAINER_RE,
    canonical_structure_marker,
    is_table_start,
    list_item,
    read_table,
    structure_marker_for_line,
)

NAV_LEVELS = 2  # the table of contents lists chapters and, under them, subheads (## headings)

STYLESHEET = """\
body { margin: 0 4%; line-height: 1.4; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; margin: 1.6em 0 0.6em; }
h1 { text-align: center; font-size: 1.6em; margin-top: 3em; page-break-before: always; }
h1.part { font-size: 1.9em; }
.hidden-heading { display: none; }
p { margin: 0; text-indent: 1.2em; }
h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p, .scene + p, .ornament + p, blockquote + p, .block + p { text-indent: 0; }
.flush-left, .centered, .attribution, .caption, .subtitle, .element-author { text-indent: 0; }
.centered, .ornament, .scene, .subtitle, .element-author { text-align: center; }
.scene, .ornament { margin: 1.5em 0; }
.attribution { text-align: right; font-style: italic; }
.caption { font-size: 0.85em; text-align: center; margin: 0.3em 0 1em; }
blockquote { margin: 1em 2em; font-style: italic; }
blockquote p { text-indent: 0; }
.block { margin: 1em 0; }
.block p { text-indent: 0; }
.block-verse p { margin-left: 2em; }
.block-written-note { border-left: 3px solid #999; padding-left: 1em; font-family: cursive, serif; }
.block-text-conversation p { font-family: sans-serif; font-size: 0.95em; margin: 0.2em 0; }
.sc { font-variant: small-caps; }
.mono, code { font-family: monospace; }
.sans { font-family: sans-serif; }
ul, ol { margin: 0.8em 0; padding-left: 2em; }
li p { text-indent: 0; }
table { border-collapse: collapse; margin: 1em auto; }
th, td { border: 1px solid #888; padding: 0.25em 0.6em; text-indent: 0; }
th { font-weight: bold; }
.align-center { text-align: center; }
.align-right { text-align: right; }
.align-left { text-align: left; }
.titlepage { text-align: center; margin-top: 25%; }
.titlepage h1 { page-break-before: avoid; margin-top: 0; }
.titlepage .subtitle { font-size: 1.2em; margin-bottom: 2em; }
"""

LINK_RE = re.compile(r"(?<!!)\[([^\]\n]+)\]\(((?:https?://|mailto:)[^\s)]+)\)")  # not ![image](...)
BR_RE = re.compile(r"<br\s*/?>", re.I)
MARKER_CLASS = {
    "subtitle": "subtitle",
    "element-author": "element-author",
    "attribution": "attribution",
    "centered": "centered",
    "flush-left": "flush-left",
    "caption": "caption",
    "hidden-heading": "hidden-heading",
}


# ---- inline text -------------------------------------------------------------------------------------------

def _plain_html(text: str) -> str:
    """Escaped text with [label](http...) links turned into anchors."""
    out = []
    pos = 0
    for match in LINK_RE.finditer(text):
        out.append(escape(text[pos:match.start()]))
        out.append(f"<a href={quoteattr(match.group(2))}>{escape(match.group(1))}</a>")
        pos = match.end()
    out.append(escape(text[pos:]))
    return "".join(out)


def inline_html(text: str) -> str:
    """Inline Markdown and [[sc:..]] style markers as XHTML."""
    out: List[str] = []
    pos = 0
    for match in INLINE_TOKEN_RE.finditer(text):
        out.append(_plain_html(text[pos:match.start()]))
        if match.group(2):
            kind, content = match.group(2), escape(match.group(3) or "")
            out.append(f"<u>{content}</u>" if kind == "u" else f'<span class="{kind}">{content}</span>')
        elif match.group(4) is not None:
            out.append(f"<strong><em>{escape(match.group(4))}</em></strong>")
        elif match.group(5) is not None:
            out.append(f"<strong>{escape(match.group(5))}</strong>")
        elif match.group(6) is not None:
            out.append(f"<em>{escape(match.group(6))}</em>")
        else:
            out.append(f"<code>{escape(match.group(7) or '')}</code>")
        pos = match.end()
    out.append(_plain_html(text[pos:]))
    return "".join(out)


def plain_text(text: str) -> str:
    """The text of a line without inline markers (for titles and the table of contents)."""
    def inner(match: Any) -> str:
        for group in (3, 4, 5, 6, 7):
            if match.group(group) is not None:
                return match.group(group)
        return match.group(0)

    return LINK_RE.sub(lambda m: m.group(1), INLINE_TOKEN_RE.sub(inner, text)).strip()


# ---- the book ---------------------------------------------------------------------------------------------

class Chapter:
    def __init__(self, title: str, part: bool = False, front: bool = False) -> None:
        self.title = title
        self.part = part
        self.front = front
        self.html: List[str] = []
        self.subheads: List[Tuple[str, str]] = []  # (anchor, title) of the ## headings


class ListState:
    def __init__(self) -> None:
        self.kinds: List[bool] = []  # ordered? for every open list, outermost first
        self.indents: List[int] = []

    def level_for(self, indent: int) -> int:
        while self.indents and indent < self.indents[-1]:
            self.indents.pop()
        if not self.indents or indent > self.indents[-1]:
            self.indents.append(indent)
        return len(self.indents) - 1

    def close(self, html: List[str]) -> None:
        while self.kinds:
            html.append("</li></ol>" if self.kinds.pop() else "</li></ul>")
        self.indents = []

    def item(self, html: List[str], indent: int, ordered: bool, number: int, content: str) -> None:
        level = self.level_for(indent)
        while len(self.kinds) > level + 1:
            html.append("</li></ol>" if self.kinds.pop() else "</li></ul>")
        opened = False
        if len(self.kinds) == level + 1:
            if self.kinds[-1] != ordered:
                html.append("</li></ol>" if self.kinds.pop() else "</li></ul>")
                opened = True
            else:
                html.append("</li>")
        else:
            opened = True
        if opened:
            self.kinds.append(ordered)
            html.append(f'<ol start="{number}">' if ordered and number not in (0, 1) else "<ol>" if ordered else "<ul>")
        html.append(f"<li>{inline_html(content)}")


def table_html(header: List[str], alignments: List[str], rows: List[List[str]]) -> str:
    columns = max([len(header), len(alignments)] + [len(row) for row in rows])

    def cell(tag: str, text: str, column: int) -> str:
        align = alignments[column] if column < len(alignments) else ""
        attr = f' class="align-{align}"' if align else ""
        pieces = [inline_html(part.strip()) for part in BR_RE.split(text)]
        return f"<{tag}{attr}>{'<br/>'.join(pieces)}</{tag}>"

    def row(tag: str, cells: List[str]) -> str:
        cells = cells + [""] * (columns - len(cells))
        return "<tr>" + "".join(cell(tag, text, c) for c, text in enumerate(cells)) + "</tr>"

    head = f"<thead>{row('th', header)}</thead>"
    body = "".join(row("td", cells) for cells in rows)
    return f"<table>{head}<tbody>{body}</tbody></table>" if rows else f"<table>{head}</table>"


def build_chapters(text: str, lists_enabled: bool = True) -> List[Chapter]:
    lines = text.split("\n")
    chapters: List[Chapter] = []
    current = Chapter("Front matter", front=True)
    block_marker = ""
    lists = ListState()
    quote_open = False
    heading_count = 0

    def close_flow() -> None:
        nonlocal quote_open
        lists.close(current.html)
        if quote_open:
            current.html.append("</blockquote>")
            quote_open = False

    index = 0
    while index < len(lines):
        line = lines[index].rstrip("\r")
        container = MARKDOWN_CONTAINER_RE.match(line)
        if container:
            close_flow()
            if block_marker:
                current.html.append("</div>")
                block_marker = ""
            else:
                block_marker = canonical_structure_marker(container.group(1) or "") or "block"
                current.html.append(f'<div class="block block-{escape(block_marker)}">')
            index += 1
            continue
        if not block_marker and is_table_start(lines, index):
            close_flow()
            header, alignments, rows, index = read_table(lines, index)
            current.html.append(table_html(header, alignments, rows))
            continue
        marker, content = structure_marker_for_line(line, block_marker)
        index += 1
        if not line.strip():
            if not (lists.kinds and _next_is_list_item(lines, index - 1)):
                close_flow()
            continue
        item = list_item(line) if lists_enabled and not marker and not block_marker else None
        if item:
            if quote_open:
                close_flow()
            lists.item(current.html, *item)
            continue
        if marker == "quote":
            lists.close(current.html)  # a quote may go on, a list may not
        else:
            close_flow()
        if marker in ("chapter", "part"):
            if current.html:
                chapters.append(current)
            current = Chapter(plain_text(content), part=marker == "part")
            attributes = f' id="ch{len(chapters) + 1}"' + (' class="part"' if marker == "part" else "")
            current.html.append(f"<h1{attributes}>{inline_html(content)}</h1>")
            continue
        if marker.startswith("subhead"):
            level = min(6, int(marker[len("subhead"):]) + 1)
            heading_count += 1
            anchor = f"sec{heading_count}"
            current.html.append(f'<h{level} id="{anchor}">{inline_html(content)}</h{level}>')
            if level <= NAV_LEVELS:
                current.subheads.append((anchor, plain_text(content)))
            continue
        if marker == "scene":
            current.html.append('<p class="scene">* * *</p>')
            continue
        if marker == "ornament":
            current.html.append(f'<p class="ornament">{inline_html(content or "* * *")}</p>')
            continue
        if marker == "quote":
            if not quote_open:
                current.html.append("<blockquote>")
                quote_open = True
            current.html.append(f"<p>{inline_html(content)}</p>")
            continue
        if marker == "hidden-heading":
            heading_count += 1
            anchor = f"sec{heading_count}"
            current.html.append(f'<h2 class="hidden-heading" id="{anchor}">{inline_html(content)}</h2>')
            current.subheads.append((anchor, plain_text(content)))
            continue
        css = MARKER_CLASS.get(marker, "")
        current.html.append(f'<p class="{css}">{inline_html(content)}</p>' if css else f"<p>{inline_html(content)}</p>")
    close_flow()
    if block_marker:
        current.html.append("</div>")
    if current.html or not chapters:
        chapters.append(current)
    return [c for c in chapters if c.html] or [Chapter("Text")]


def _next_is_list_item(lines: List[str], index: int) -> bool:
    for later in lines[index + 1:]:
        if later.strip():
            return list_item(later) is not None
    return False


# ---- the package -------------------------------------------------------------------------------------------

LABELS = {
    "en": {"contents": "Contents", "title page": "Title page", "front matter": "Front matter", "part": "Part"},
    "nl": {"contents": "Inhoud", "title page": "Titelpagina", "front matter": "Voorwerk", "part": "Deel"},
}


def label(language: str, key: str) -> str:
    return LABELS.get(language, LABELS["en"])[key]


def xhtml_page(title: str, language: str, body: str, css_class: str = "") -> str:
    body_class = f" class={quoteattr(css_class)}" if css_class else ""
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
        f'<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="{language}" xml:lang="{language}">\n'
        f'<head><meta charset="utf-8"/><title>{escape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>\n'
        f'<body{body_class}>\n{body}\n</body>\n</html>\n'
    )


def book_language(metadata: Dict[str, str]) -> str:
    code = normalize_language(metadata.get("language"))
    if code in ("en", "nl"):
        return code
    raw = (metadata.get("language") or "").strip()
    return raw if re.fullmatch(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*", raw) else "und"


def create_manuscript_epub(text: str, metadata: Dict[str, str], options: Optional[Dict[str, Any]] = None) -> bytes:
    """The manuscript as an EPUB 3 file. `options["lists"] = False` keeps list markers as literal text."""
    lists_enabled = (options or {}).get("lists") is not False
    title = (metadata.get("title") or "").strip() or "Untitled manuscript"
    author = (metadata.get("author") or "").strip()
    language = book_language(metadata)
    chapters = build_chapters(text, lists_enabled)
    identifier = "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, f"manuscript-workbench:{title}|{author}"))
    modified = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    files: Dict[str, str] = {}
    spine: List[Tuple[str, str]] = []  # (id, file name)
    nav_entries: List[Tuple[str, str, List[Tuple[str, str]]]] = []  # (file, title, [(anchor, title)])

    if (metadata.get("title") or "").strip():
        subtitle = (metadata.get("subtitle") or "").strip()
        page = f"<h1>{escape(title)}</h1>"
        if subtitle:
            page += f'<p class="subtitle">{escape(subtitle)}</p>'
        if author:
            page += f'<p class="element-author">{escape(author)}</p>'
        files["titlepage.xhtml"] = xhtml_page(title, language, page, "titlepage")
        spine.append(("titlepage", "titlepage.xhtml"))
        nav_entries.append(("titlepage.xhtml", label(language, "title page"), []))

    for number, chapter in enumerate(chapters, start=1):
        name = f"chapter-{number:03d}.xhtml"
        files[name] = xhtml_page(title if chapter.front and len(chapters) == 1 else chapter.title or title, language, "\n".join(chapter.html))
        spine.append((f"chapter{number:03d}", name))
        nav_title = chapter.title
        if chapter.front:
            nav_title = label(language, "front matter") if len(chapters) > 1 else title
        nav_entries.append((name, nav_title or f"{label(language, 'part')} {number}", chapter.subheads))

    nav_items = []
    for name, entry_title, subs in nav_entries:
        inner = ""
        if subs:
            inner = "<ol>" + "".join(f'<li><a href="{name}#{anchor}">{escape(sub)}</a></li>' for anchor, sub in subs) + "</ol>"
        nav_items.append(f'<li><a href="{name}">{escape(entry_title)}</a>{inner}</li>')
    contents = label(language, "contents")
    nav_body = f'<nav epub:type="toc" id="toc"><h1>{escape(contents)}</h1><ol>{"".join(nav_items)}</ol></nav>'
    files["nav.xhtml"] = xhtml_page(contents, language, nav_body)

    ncx_points = []
    play = 1
    for name, entry_title, subs in nav_entries:
        ncx_points.append(f'<navPoint id="np{play}" playOrder="{play}"><navLabel><text>{escape(entry_title)}</text></navLabel><content src="{name}"/>')
        play += 1
        for anchor, sub in subs:
            ncx_points.append(f'<navPoint id="np{play}" playOrder="{play}"><navLabel><text>{escape(sub)}</text></navLabel><content src="{name}#{anchor}"/></navPoint>')
            play += 1
        ncx_points.append("</navPoint>")
    files["toc.ncx"] = (
        '<?xml version="1.0" encoding="utf-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">\n'
        f'<head><meta name="dtb:uid" content={quoteattr(identifier)}/><meta name="dtb:depth" content="2"/>'
        '<meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>\n'
        f'<docTitle><text>{escape(title)}</text></docTitle><navMap>{"".join(ncx_points)}</navMap>\n</ncx>\n'
    )
    files["style.css"] = STYLESHEET

    meta = [
        f'<dc:identifier id="book-id">{escape(identifier)}</dc:identifier>',
        f'<dc:title id="title">{escape(title)}</dc:title>',
        '<meta refines="#title" property="title-type">main</meta>',
    ]
    subtitle = (metadata.get("subtitle") or "").strip()
    if subtitle:
        meta += [f'<dc:title id="subtitle">{escape(subtitle)}</dc:title>', '<meta refines="#subtitle" property="title-type">subtitle</meta>']
    if author:
        meta += [f'<dc:creator id="author">{escape(author)}</dc:creator>', '<meta refines="#author" property="role" scheme="marc:relators">aut</meta>']
    meta.append(f"<dc:language>{escape(language)}</dc:language>")
    if (metadata.get("publisher") or "").strip():
        meta.append(f'<dc:publisher>{escape(metadata["publisher"].strip())}</dc:publisher>')
    if (metadata.get("series") or "").strip():
        meta.append(f'<meta property="belongs-to-collection" id="series">{escape(metadata["series"].strip())}</meta>')
        meta.append('<meta refines="#series" property="collection-type">series</meta>')
        if (metadata.get("bookNumber") or "").strip():
            meta.append(f'<meta refines="#series" property="group-position">{escape(metadata["bookNumber"].strip())}</meta>')
    meta.append(f'<meta property="dcterms:modified">{modified}</meta>')

    manifest = [
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="css" href="style.css" media-type="text/css"/>',
    ] + [f'<item id="{item_id}" href="{href}" media-type="application/xhtml+xml"/>' for item_id, href in spine]
    files["content.opf"] = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="' + language + '">\n'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' + "".join(meta) + "</metadata>\n"
        "<manifest>" + "".join(manifest) + "</manifest>\n"
        '<spine toc="ncx">' + "".join(f'<itemref idref="{item_id}"/>' for item_id, _ in spine) + "</spine>\n</package>\n"
    )

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as epub:
        epub.writestr(zipfile.ZipInfo("mimetype", date_time=(1980, 1, 1, 0, 0, 0)), "application/epub+zip", compress_type=zipfile.ZIP_STORED)
        epub.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n',
            compress_type=zipfile.ZIP_DEFLATED,
        )
        for name, content in files.items():
            epub.writestr(f"OEBPS/{name}", content, compress_type=zipfile.ZIP_DEFLATED)
    return out.getvalue()
