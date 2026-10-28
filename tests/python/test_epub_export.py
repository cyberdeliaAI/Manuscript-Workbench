"""EPUB 3 export: the package is well-formed and consistent, and the book reads like the DOCX export does."""
from __future__ import annotations

import io
import re
import zipfile

import pytest
from lxml import etree

NS = {
    "opf": "http://www.idpf.org/2007/opf",
    "dc": "http://purl.org/dc/elements/1.1/",
    "c": "urn:oasis:names:tc:opendocument:xmlns:container",
    "x": "http://www.w3.org/1999/xhtml",
    "ncx": "http://www.daisy.org/z3986/2005/ncx/",
}
BOOK = """Words before the first chapter.

# Part One: Beginnings

## First scene

Marta *counted* the **boats** twice, [[sc:small caps]] and `code` & <b>tags</b> and [a link](https://example.org/x?a=1&b=2).

> A quote line
> second quote line

* * *

# Chapter Two

- one
- two
    - nested
1. first
2. second

Text between the lists.

5. five
6. six

| Name | Qty |
|---|---:|
| Apple & pear | 3 |

::: verse
Roses are red
Violets are blue
:::
"""
META = {"title": "Harbour & Co", "author": "A. Writer", "language": "nl", "series": "Seven", "bookNumber": "2", "subtitle": "A tale", "publisher": "Quay Press"}


def build(mw, text=BOOK, metadata=None, **options):
    return zipfile.ZipFile(io.BytesIO(mw.create_manuscript_epub(text, META if metadata is None else metadata, options or None)))


def xml(archive, name):
    return etree.fromstring(archive.read(name))


def page(archive, name):
    return archive.read("OEBPS/" + name).decode("utf-8")


def test_package_layout_follows_the_epub_rules(mw):
    z = build(mw)
    first = z.infolist()[0]
    assert first.filename == "mimetype" and first.compress_type == zipfile.ZIP_STORED and not first.extra
    assert z.read("mimetype") == b"application/epub+zip"
    container = xml(z, "META-INF/container.xml")
    assert container.find(".//c:rootfile", NS).get("full-path") == "OEBPS/content.opf"


def test_every_xml_part_is_well_formed(mw):
    z = build(mw)
    for name in z.namelist():
        if name.endswith((".xhtml", ".opf", ".ncx", ".xml")):
            etree.fromstring(z.read(name))


def test_manifest_spine_and_files_agree(mw):
    z = build(mw)
    opf = xml(z, "OEBPS/content.opf")
    items = {i.get("id"): i for i in opf.findall(".//opf:manifest/opf:item", NS)}
    assert len(items) == len(opf.findall(".//opf:manifest/opf:item", NS))
    for item in items.values():
        assert "OEBPS/" + item.get("href") in z.namelist()
    spine = [r.get("idref") for r in opf.findall(".//opf:spine/opf:itemref", NS)]
    assert spine and all(ref in items for ref in spine)
    assert [i for i in items.values() if "nav" in (i.get("properties") or "")][0].get("href") == "nav.xhtml"
    assert opf.find(".//opf:spine", NS).get("toc") == "ncx"


def test_navigation_points_at_real_files_and_anchors(mw):
    z = build(mw)
    nav = xml(z, "OEBPS/nav.xhtml")
    hrefs = [a.get("href") for a in nav.findall(".//x:nav//x:a", NS)]
    assert len(hrefs) == 5  # title page, front matter, two chapters, one subhead
    for href in hrefs:
        name, _, anchor = href.partition("#")
        assert "OEBPS/" + name in z.namelist()
        if anchor:
            assert f'id="{anchor}"' in page(z, name)
    labels = [a.text for a in nav.findall(".//x:nav//x:a", NS)]
    assert labels == ["Titelpagina", "Voorwerk", "Part One: Beginnings", "First scene", "Chapter Two"]
    ncx = xml(z, "OEBPS/toc.ncx")
    assert [p.get("playOrder") for p in ncx.findall(".//ncx:navPoint", NS)] == ["1", "2", "3", "4", "5"]


def test_metadata_comes_from_the_book_tab(mw):
    opf = xml(build(mw), "OEBPS/content.opf")
    text = lambda path: [e.text for e in opf.findall(path, NS)]  # noqa: E731
    assert text(".//dc:title") == ["Harbour & Co", "A tale"]
    assert text(".//dc:creator") == ["A. Writer"] and text(".//dc:language") == ["nl"] and text(".//dc:publisher") == ["Quay Press"]
    metas = [(m.get("refines"), m.get("property"), m.text) for m in opf.findall(".//opf:meta", NS)]
    assert (None, "belongs-to-collection", "Seven") in metas
    assert ("#series", "collection-type", "series") in metas and ("#series", "group-position", "2") in metas
    modified = [m.text for m in opf.findall(".//opf:meta", NS) if m.get("property") == "dcterms:modified"][0]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", modified)


def test_the_identifier_is_stable_for_the_same_book(mw):
    one = xml(build(mw), "OEBPS/content.opf").find(".//dc:identifier", NS).text
    two = xml(build(mw, text="Other text."), "OEBPS/content.opf").find(".//dc:identifier", NS).text
    other = xml(build(mw, metadata={"title": "Another"}), "OEBPS/content.opf").find(".//dc:identifier", NS).text
    assert one == two != other and one.startswith("urn:uuid:")


def test_headings_start_chapter_files_and_front_matter_gets_its_own(mw):
    z = build(mw)
    assert "Words before the first chapter." in page(z, "chapter-001.xhtml")
    assert '<h1 id="ch2" class="part">Part One: Beginnings</h1>' in page(z, "chapter-002.xhtml")
    assert '<h2 id="sec1">First scene</h2>' in page(z, "chapter-002.xhtml")
    assert "<h1 id=\"ch3\">Chapter Two</h1>" in page(z, "chapter-003.xhtml")


def test_inline_markup_links_and_escaping(mw):
    html = page(build(mw), "chapter-002.xhtml")
    assert "<em>counted</em>" in html and "<strong>boats</strong>" in html
    assert '<span class="sc">small caps</span>' in html and "<code>code</code>" in html
    assert "&amp; &lt;b&gt;tags&lt;/b&gt;" in html  # nothing typed in the manuscript becomes markup
    assert '<a href="https://example.org/x?a=1&amp;b=2">a link</a>' in html
    assert "<title>Part One: Beginnings</title>" in html


def test_quotes_scene_breaks_and_blocks(mw):
    z = build(mw)
    assert "<blockquote>\n<p>A quote line</p>\n<p>second quote line</p>\n</blockquote>" in page(z, "chapter-002.xhtml")
    assert '<p class="scene">* * *</p>' in page(z, "chapter-002.xhtml")
    assert '<div class="block block-verse">\n<p>Roses are red</p>\n<p>Violets are blue</p>\n</div>' in page(z, "chapter-003.xhtml")


def test_lists_nest_and_numbered_lists_keep_their_start(mw):
    html = page(build(mw), "chapter-003.xhtml")
    assert re.search(r"<ul>\s*<li>one\s*</li>\s*<li>two\s*<ul>\s*<li>nested\s*</li></ul>\s*</li></ul>", html)
    assert re.search(r"<ol>\s*<li>first\s*</li>\s*<li>second\s*</li></ol>", html)
    assert '<ol start="5">' in html


def test_tables_have_a_header_alignment_and_escaped_cells(mw):
    html = page(build(mw), "chapter-003.xhtml")
    assert '<thead><tr><th>Name</th><th class="align-right">Qty</th></tr></thead>' in html
    assert '<td>Apple &amp; pear</td><td class="align-right">3</td>' in html


def test_lists_can_be_switched_off(mw):
    html = page(build(mw, text="# C\n\n- a\n- b", lists=False), "chapter-001.xhtml")
    assert "<ul>" not in html and "<p>- a</p>" in html


def test_a_book_without_headings_is_one_chapter_named_after_the_book(mw):
    z = build(mw, text="Just some text.\n\nMore text.", metadata={"title": "Plain Book"})
    nav = xml(z, "OEBPS/nav.xhtml")
    assert [a.text for a in nav.findall(".//x:nav//x:a", NS)] == ["Title page", "Plain Book"]
    assert "OEBPS/chapter-001.xhtml" in z.namelist() and "OEBPS/chapter-002.xhtml" not in z.namelist()


def test_without_a_title_there_is_no_title_page_and_the_language_is_undetermined(mw):
    z = build(mw, text="# One\n\ntext", metadata={})
    assert "OEBPS/titlepage.xhtml" not in z.namelist()
    opf = xml(z, "OEBPS/content.opf")
    assert opf.find(".//dc:language", NS).text == "und" and opf.find(".//dc:title", NS).text == "Untitled manuscript"


def test_an_empty_manuscript_still_makes_a_valid_book(mw):
    z = build(mw, text="", metadata={})
    for name in z.namelist():
        if name.endswith((".xhtml", ".opf", ".ncx")):
            etree.fromstring(z.read(name))


def test_export_endpoint_returns_an_epub_download(server):
    status, headers, data = server.request("POST", "/api/export_epub", body={"text": "# One\n\ntext", "metadata": {"title": "T"}, "filename": "my book"})
    assert status == 200 and headers["Content-Type"] == "application/epub+zip"
    assert 'filename="my-book.epub"' in headers["Content-Disposition"] or ".epub" in headers["Content-Disposition"]
    assert zipfile.ZipFile(io.BytesIO(data)).read("mimetype") == b"application/epub+zip"
