"""HTML to text extraction for file and URL import."""
from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple

from .deps import lxml_html, trafilatura
from .textio import normalize_imported_text


class ManuscriptHTMLTextExtractor(HTMLParser):
    block_tags = {
        "address", "article", "blockquote", "body", "dd", "details", "dialog", "div", "dl", "dt",
        "fieldset", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6",
        "hr", "li", "main", "ol", "p", "pre", "section", "table", "tbody", "td", "tfoot", "th", "thead",
        "tr", "ul",
    }
    skip_tags = {"script", "style", "noscript", "template", "head", "svg", "canvas", "nav", "header", "footer", "aside", "form", "menu"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self.skip_depth = 0

    def newline(self) -> None:
        if self.parts and not self.parts[-1].endswith("\n"):
            self.parts.append("\n")

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        if tag in self.skip_tags:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag == "br":
            self.newline()
        elif tag in self.block_tags:
            self.newline()

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.skip_tags and self.skip_depth:
            self.skip_depth -= 1
            return
        if self.skip_depth:
            return
        if tag in self.block_tags:
            self.newline()

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)

    def text(self) -> str:
        text = "".join(self.parts)
        text = text.replace("\xa0", " ")
        text = re.sub(r"[ \t\f\v]+", " ", text)
        text = re.sub(r" *\n *", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def html_to_text(source: str) -> str:
    if lxml_html is not None:
        try:
            source = readable_html_fragment(source)
        except Exception:
            pass
    parser = ManuscriptHTMLTextExtractor()
    parser.feed(source)
    parser.close()
    return parser.text()


def trafilatura_html_to_text(source: str, url: str = "") -> str:
    if trafilatura is None:
        raise RuntimeError("trafilatura is not installed. Run: pip install -r requirements.txt")
    extracted = trafilatura.extract(
        source or "",
        url=url or None,
        output_format="markdown",
        include_comments=False,
        include_tables=True,
        include_images=False,
        include_links=False,
        favor_precision=True,
    )
    if not extracted or not extracted.strip():
        raise ValueError("Trafilatura could not find readable main text.")
    return normalize_imported_text(extracted)


def html_import_options(source: str, filename: str = "import.html", url: str = "") -> Dict[str, Any]:
    simple = normalize_imported_text(html_to_text(source or ""))
    main = ""
    main_error = ""
    try:
        main = trafilatura_html_to_text(source or "", url=url)
    except Exception as exc:
        main_error = str(exc)
    notes = []
    if simple:
        notes.append("Simple extraction available")
    if main:
        notes.append("Trafilatura main text available")
    elif main_error:
        notes.append(f"Trafilatura unavailable: {main_error}")
    return {
        "filename": filename,
        "url": url,
        "simple": {"text": simple, "chars": len(simple)},
        "main": {"text": main, "chars": len(main), "error": main_error},
        "notes": notes,
        "engine": "trafilatura" if trafilatura is not None else "simple-only",
    }


def readable_html_fragment(source: str) -> str:
    tree = lxml_html.fromstring(source)
    boilerplate_xpath = (
        "//script|//style|//noscript|//template|//svg|//canvas|//nav|//header|//footer|//aside|//form|//menu|"
        "//*[contains(translate(concat(' ', @class, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' sidebar ')]|"
        "//*[contains(translate(concat(' ', @class, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' navigation ')]|"
        "//*[contains(translate(concat(' ', @class, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' menu ')]|"
        "//*[contains(translate(concat(' ', @class, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' footer ')]|"
        "//*[contains(translate(concat(' ', @class, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' header ')]|"
        "//*[contains(translate(concat(' ', @id, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' sidebar ')]|"
        "//*[contains(translate(concat(' ', @id, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' navigation ')]|"
        "//*[contains(translate(concat(' ', @id, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' menu ')]|"
        "//*[contains(translate(concat(' ', @id, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' footer ')]|"
        "//*[contains(translate(concat(' ', @id, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' header ')]"
    )
    for el in tree.xpath(boilerplate_xpath):
        parent = el.getparent()
        if parent is not None:
            parent.remove(el)
    candidates = tree.xpath(
        "//main|//article|//*[@role='main']|"
        "//*[contains(translate(concat(' ', @class, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' content ')]|"
        "//*[contains(translate(concat(' ', @class, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' post ')]|"
        "//*[contains(translate(concat(' ', @class, ' '), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), ' entry ')]|"
        "//*[@id='content' or @id='main' or @id='article']"
    )
    if candidates:
        best = max(candidates, key=lambda el: len(" ".join(el.itertext()).strip()))
        return lxml_html.tostring(best, encoding="unicode", method="html")
    return lxml_html.tostring(tree, encoding="unicode", method="html")
