"""Optional third-party dependencies. A missing package becomes None so the app can report it clearly."""
from __future__ import annotations


try:
    import requests
except Exception:  # pragma: no cover
    requests = None


try:
    import markdown as markdown_lib
except Exception:  # pragma: no cover
    markdown_lib = None


try:
    from lxml import html as lxml_html
except Exception:  # pragma: no cover
    lxml_html = None


try:
    import trafilatura
except Exception:  # pragma: no cover
    trafilatura = None


try:
    from docx import Document
    from docx.enum.style import WD_STYLE_TYPE
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt
except Exception:  # pragma: no cover
    Document = None
    WD_STYLE_TYPE = None
    WD_ALIGN_PARAGRAPH = None
    OxmlElement = None
    qn = None
    Pt = None
