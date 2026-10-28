"""Markdown preview rendering with an allow-list HTML sanitizer."""
from __future__ import annotations

import html as html_std
import re
from html.parser import HTMLParser
from typing import List, Optional, Tuple

from .deps import markdown_lib
from .structure import canonical_structure_marker


MARKDOWN_ALLOWED_TAGS = {
    "a", "b", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "i", "img", "li", "mark", "ol", "p", "pre", "s", "small", "span", "strong", "sub", "sup",
    "table", "tbody", "td", "th", "thead", "tr", "u", "ul",
}

MARKDOWN_VOID_TAGS = {"br", "hr", "img"}

# Tags that are removed together with everything inside them. Any other tag that is not allowed is
# "unwrapped": the tag disappears but its text stays (so <font>text</font> does not lose its text).
MARKDOWN_DROP_WITH_CONTENT_TAGS = {
    "applet", "embed", "frameset", "iframe", "math", "noscript", "object", "script", "style", "svg", "template",
}

MARKDOWN_ALLOWED_ATTRS = {
    "a": {"href", "title"},
    "img": {"src", "alt", "title"},
    "code": {"class"},
    "div": {"class"},
    "span": {"class"},
}

MARKDOWN_SAFE_CLASS_RE = re.compile(r"^(?:language-[A-Za-z0-9_-]+|block|block-label|block-[A-Za-z0-9_-]+|scene|sc|sans|task)$")

INLINE_MARKER_RE = re.compile(r"\[\[(sc|mono|sans|u):(.+?)\]\]", re.S)


def markdown_safe_url(value: str) -> str:
    raw = (value or "").strip()
    if not raw or re.search(r"[\s<>\"']", raw):
        return ""
    if re.match(r"^(?:https?:|mailto:|#|/|\./|\.\./)", raw, re.I):
        return raw
    return ""


class MarkdownHTMLSanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        if tag in MARKDOWN_DROP_WITH_CONTENT_TAGS:
            self.skip_depth += 1
            return
        if tag not in MARKDOWN_ALLOWED_TAGS or self.skip_depth:
            return  # unknown tag: unwrapped (only its text survives)
        clean_attrs: List[str] = []
        allowed = MARKDOWN_ALLOWED_ATTRS.get(tag, set())
        for name, value in attrs:
            name = name.lower()
            value = value or ""
            if name not in allowed:
                continue
            if name in {"href", "src"}:
                value = markdown_safe_url(value)
                if not value:
                    continue
            elif name == "class":
                classes = [c for c in value.split() if MARKDOWN_SAFE_CLASS_RE.fullmatch(c)]
                if not classes:
                    continue
                value = " ".join(classes)
            clean_attrs.append(f'{name}="{html_std.escape(value, quote=True)}"')
        attr_text = (" " + " ".join(clean_attrs)) if clean_attrs else ""
        self.parts.append(f"<{tag}{attr_text}>")

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        if tag in MARKDOWN_DROP_WITH_CONTENT_TAGS:
            return  # a self-closed <svg/> has no content to skip and no end tag to wait for
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in MARKDOWN_DROP_WITH_CONTENT_TAGS:
            if self.skip_depth:
                self.skip_depth -= 1
            return
        if tag not in MARKDOWN_ALLOWED_TAGS or self.skip_depth:
            return
        if tag not in MARKDOWN_VOID_TAGS:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(html_std.escape(data, quote=False))

    def handle_entityref(self, name: str) -> None:
        if not self.skip_depth:
            self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        if not self.skip_depth:
            self.parts.append(f"&#{name};")

    def html(self) -> str:
        return "".join(self.parts)


def sanitize_markdown_html(value: str) -> str:
    parser = MarkdownHTMLSanitizer()
    parser.feed(value or "")
    parser.close()
    return parser.html()


def render_inline_markers_for_preview(line: str) -> str:
    def repl(match: re.Match[str]) -> str:
        kind = match.group(1)
        content = html_std.escape(match.group(2) or "", quote=False)
        if kind == "u":
            return f"<u>{content}</u>"
        if kind == "mono":
            return f"<code>{content}</code>"
        return f'<span class="{kind}">{content}</span>'

    return INLINE_MARKER_RE.sub(repl, line)


def preprocess_manuscript_markdown(text: str) -> str:
    lines = (text or "").splitlines()
    out: List[str] = []
    open_block = False
    code_fence = ""
    for line in lines:
        fence = re.match(r"^\s*(```+|~~~+)", line)
        if code_fence:
            out.append(line)
            if fence and fence.group(1).startswith(code_fence[0]):
                code_fence = ""
            continue
        if fence:
            code_fence = fence.group(1)
            out.append(line)
            continue
        marker = re.match(r"^\s*:::\s*([A-Za-z0-9_-]+)?\s*$", line)
        if marker:
            if open_block:
                out.append("")
                out.append("</div>")
                open_block = False
            else:
                name = canonical_structure_marker(marker.group(1) or "block")
                safe_name = html_std.escape(name, quote=True)
                out.append(f'<div class="block block-{safe_name}" markdown="1">')
                out.append(f'<div class="block-label">{safe_name}</div>')
                out.append("")
                open_block = True
            continue
        if re.fullmatch(r"\s*(?:\*\s*){3,}\s*|\s*[-–—]{3,}\s*|\s*~{3,}\s*", line):
            out.append('<div class="scene">* * *</div>')
            continue
        list_indent = re.match(r"^( +)((?:[-+*])|(?:\d+[.)]))\s+", line)
        if list_indent and (len(list_indent.group(1)) % 4):
            depth = max(1, (len(list_indent.group(1)) + 1) // 2)
            line = (" " * (depth * 4)) + line[len(list_indent.group(1)):]
        out.append(render_inline_markers_for_preview(line))
    if open_block:
        out.append("")
        out.append("</div>")
    return "\n".join(out)


def render_markdown_html(text: str) -> str:
    if markdown_lib is None:
        raise RuntimeError("Python-Markdown is not installed. Run: pip install -r requirements.txt")
    rendered = markdown_lib.markdown(
        preprocess_manuscript_markdown(text or ""),
        extensions=["extra", "sane_lists", "nl2br"],
        output_format="html5",
    )
    return sanitize_markdown_html(rendered)


def render_help_page(markdown_text: str) -> str:
    try:
        body = render_markdown_html(markdown_text)
    except Exception:
        body = f"<pre>{html_std.escape(markdown_text)}</pre>"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Manuscript Workbench Help</title>
<style>
body{{margin:0;background:#171613;color:#ede7da;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}}
main{{max-width:900px;margin:0 auto;padding:34px 28px 64px}}
h1,h2,h3{{line-height:1.2;color:#fff}} h1{{font-size:32px}} h2{{margin-top:2em;border-top:1px solid #3a372f;padding-top:1em}}
a{{color:#7fc4ef}} code{{background:#2a2823;border-radius:4px;padding:.1em .32em}} pre{{background:#211f1b;border:1px solid #3a372f;border-radius:8px;padding:14px;overflow:auto}}
blockquote{{border-left:4px solid #e0a458;margin:1em 0;padding:.2em 0 .2em 1em;color:#d8d0c1}} table{{border-collapse:collapse;width:100%}} th,td{{border:1px solid #3a372f;padding:6px 8px}}
</style>
</head>
<body><main>{body}</main></body>
</html>"""
