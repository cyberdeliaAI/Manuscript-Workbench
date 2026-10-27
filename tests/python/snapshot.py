"""Computes a JSON-serialisable snapshot of the observable behaviour of the Python side.

The snapshot is stored as tests/fixtures/golden/py_snapshot.json by
tests/tools/generate_golden_py.py and compared by test_snapshot.py. Whenever a behaviour change is
intentional, regenerate the file and review the git diff: that diff *is* the behaviour change.
"""
from __future__ import annotations

import io
from typing import Any, Dict


def _docx_summary(data: bytes) -> Dict[str, Any]:
    from docx import Document

    doc = Document(io.BytesIO(data))
    paragraphs = []
    for p in doc.paragraphs:
        paragraphs.append({
            "style": p.style.name if p.style is not None else None,
            "text": p.text,
            "align": str(p.alignment) if p.alignment is not None else None,
            "runs": [
                {
                    "t": r.text,
                    "b": r.bold,
                    "i": r.italic,
                    "u": r.underline,
                    "style": r.style.name if r.style is not None else None,
                    "sc": r.font.small_caps,
                }
                for r in p.runs
            ],
        })
    cp = doc.core_properties
    return {
        "paragraphs": paragraphs,
        "title": cp.title,
        "author": cp.author,
        "subject": cp.subject,
        "keywords": cp.keywords,
        "comments": cp.comments,
    }


FAKE_DNS = {"example.com": ["93.184.216.34"], "localtest.me": ["127.0.0.1"], "intranet": ["10.1.2.3"]}


def _fake_resolver(hostname, port):
    import socket

    if hostname in FAKE_DNS:
        return FAKE_DNS[hostname]
    raise socket.gaierror(f"unknown host {hostname}")


def _outcome(fn, *args):
    try:
        return {"ok": fn(*args)}
    except Exception as exc:  # noqa: BLE001 - we record any failure mode
        return {"error": f"{type(exc).__name__}: {exc}"}


SANITIZE_VECTORS = {
    "script": "<p>a</p><script>alert(1)</script><p>b</p>",
    "onerror_img": '<img src="x" onerror="alert(1)">',
    "javascript_href": '<a href="javascript:alert(1)">x</a>',
    "whitespace_javascript_href": '<a href=" javascript:alert(1)">x</a>',
    "data_img": '<img src="data:text/html;base64,AAAA">',
    "protocol_relative": '<a href="//evil.example/x">x</a>',
    "style_attr": '<div class="block" style="position:fixed">x</div>',
    "iframe": '<iframe src="http://x"></iframe><p>after</p>',
    "raw_b_i": "<p>Hello <b>world</b> and <i>there</i> end</p>",
    "raw_font": "<p>Hello <font color=red>red text</font> end</p>",
    "void_input": "<p>a</p><input><p>text AFTER input</p><p>more text</p>",
    "void_wbr": "<p>before</p><wbr><p>after</p>",
    "nested_allowed": '<div class="block block-verse"><span class="sc">x</span> <u>u</u></div>',
    "entities": "<p>a &amp; b &lt; c &#169; d</p>",
    "svg": '<svg onload="alert(1)"><circle/></svg><p>kept?</p>',
    "mailto": '<a href="mailto:a@b.example">mail</a>',
    "relative": '<a href="../x.md">rel</a><a href="#top">top</a>',
}

HTML_SAMPLE = (
    "<html><head><title>T</title><style>.x{}</style></head><body><nav>Menu Home</nav>"
    "<article><h1>Title</h1><p>First paragraph with <b>bold</b>.</p><p>Second&nbsp;paragraph.</p></article>"
    "<footer>Footer text</footer><script>var a=1;</script></body></html>"
)

def rtf(markup: str) -> str:
    """RTF control words are written with '@' here so no backslash-u sequence appears in this source."""
    return markup.replace("@", chr(92))


RTF_SAMPLE = rtf(
    "{@rtf1@ansi@deff0{@fonttbl{@f0 Arial;}}{@*@generator Foo;}@pard Hello {@b bold} world.@par "
    "Caf@'e9 @u8220?quoted@u8221? @emdash  dash@par Third@tab tabbed@par}"
)

HOST_CASES = [
    "localhost", "LOCALHOST.", "foo.localhost", "127.0.0.1", "127.1", "2130706433", "0x7f.0.0.1",
    "0177.0.0.1", "::1", "::ffff:127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "0.0.0.0",
    "localtest.me", "intranet", "example.com",
]

URL_CASES = [
    "http://127.1:8765/", "http://2130706433/", "http://127.0.0.1/", "file:///etc/passwd",
    "http://user:pw@example.com/", "ftp://example.com/", "https://example.com/a?b=1#c", "example.com",
    "http://localtest.me/", "http://intranet/", "http://[::1]:8765/", "http://nonexistent.invalid/",
]

LINE_CASES = [
    "# Chapter", "## Sub", "###### Deep", "####### too deep", "# Part One", "# Deel Twee", "   # indented3",
    "    # indented4", "> quote", ">quote", "***", "* * *", "---", "~~~", "- - -", "plain text", "",
]


def compute_snapshot(mw: Any, corpus: Dict[str, str]) -> Dict[str, Any]:
    snap: Dict[str, Any] = {}

    decode_cases = {
        "utf8": "Café ok".encode("utf-8"),
        "utf8_bom": b"\xef\xbb\xbfhello\r\nworld",
        "utf16_bom_le": b"\xff\xfe" + "héllo\nworld".encode("utf-16-le"),
        "utf16_bom_be": b"\xfe\xff" + "héllo".encode("utf-16-be"),
        "utf16_le_nobom": "Hello world, this is a longer line of text\n".encode("utf-16-le"),
        "cp1252": "Café “quoted”".encode("cp1252"),
        "cr_only": b"a\rb\rc",
    }
    snap["decode"] = {k: list(mw.decode_text_bytes(v)) for k, v in decode_cases.items()}
    snap["rtf"] = mw.rtf_to_text(RTF_SAMPLE)

    snap["preflight"] = {
        name: {
            "no_meta": mw.preflight(text, {}),
            "with_meta": mw.preflight(text, {"title": "T", "author": "A"}),
        }
        for name, text in sorted(corpus.items())
    }

    structure = corpus["structure_en"]
    snap["preprocess_markdown"] = mw.preprocess_manuscript_markdown(structure)
    snap["render_markdown"] = mw.render_markdown_html(structure)
    snap["sanitize"] = {k: mw.sanitize_markdown_html(v) for k, v in SANITIZE_VECTORS.items()}

    snap["html_to_text"] = mw.html_to_text(HTML_SAMPLE)
    snap["import_file"] = {
        "md": _outcome(mw.import_file, "a.md", b"# Title\r\ntext"),
        "txt_cp1252": _outcome(mw.import_file, "a.txt", "Café".encode("cp1252")),
        "rtf_by_extension": _outcome(mw.import_file, "a.rtf", RTF_SAMPLE.encode("utf-8")),
        "rtf_by_sniff": _outcome(mw.import_file, "noext", RTF_SAMPLE.encode("utf-8")),
        "html_simple": _outcome(mw.import_file, "a.html", HTML_SAMPLE.encode("utf-8"), "simple"),
        "old_doc": _outcome(mw.import_file, "a.doc", b"x"),
    }

    docx_bytes = mw.create_manuscript_docx(structure, {"title": "T", "author": "A", "subtitle": "S", "language": "en"})
    snap["docx_export"] = _docx_summary(docx_bytes)
    text_back, notes_back = mw.import_docx_bytes(docx_bytes)
    snap["docx_roundtrip"] = {"text": text_back, "notes": notes_back}

    snap["is_blocked_import_host"] = {h: mw.is_blocked_import_host(h) for h in HOST_CASES}
    original_resolver = getattr(mw, "_resolve_host", None)
    if original_resolver is not None:  # the resolver is faked so the snapshot never depends on real DNS
        mw._resolve_host = _fake_resolver
    try:
        snap["validate_import_url"] = {u: _outcome(mw.validate_import_url, u) for u in URL_CASES}
    finally:
        if original_resolver is not None:
            mw._resolve_host = original_resolver
    snap["normalize_base_url"] = {
        f"{base}|{prov}": mw.normalize_base_url(base, prov)
        for base, prov in [("", "lmstudio"), ("localhost:1234", "lmstudio"), ("http://localhost:8000", "omlx"),
                           ("http://x/v1/", "custom"), ("http://x/api", "custom"), ("", "unknown")]
    }
    snap["parse_chapter_number"] = {
        s: mw.parse_chapter_number(s)
        for s in ["Chapter 5", "# Chapter Twelve", "Hoofdstuk VII", "chapter x", "Chapter Zzz", "Prologue"]
    }
    snap["safe_filename"] = {s: mw.safe_filename(s) for s in ["My Book: Part 1!", "", "../../etc/passwd", "ok-name_1.2"]}
    snap["markdown_line_marker"] = {line: list(mw.markdown_line_marker(line)) for line in LINE_CASES}
    return snap
