"""The frontend is served from static/: right content types, no path traversal, strict script CSP."""
from __future__ import annotations

import json

import pytest


def test_index_references_external_assets_and_has_no_inline_script(server):
    status, headers, body = server.request("GET", "/", token=False)
    page = body.decode("utf-8")
    assert status == 200 and headers["Content-Type"].startswith("text/html")
    assert '<link rel="stylesheet" href="/static/css/app.css">' in page
    assert '<script type="module" src="/static/js/main.js"></script>' in page
    assert 'style="' not in page, "inline style attributes would need 'unsafe-inline' for styles"
    import re

    inline_scripts = [m for m in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", page)]
    assert inline_scripts == [], "inline <script> blocks would need 'unsafe-inline'"
    csp = headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "style-src 'self'" in csp
    assert "unsafe-inline" not in csp


def test_the_page_shows_the_version_the_server_reports(mw, server):
    page = server.request("GET", "/", token=False)[2].decode("utf-8")
    assert f"v{mw.APP_VERSION} " in page and f"Version {mw.APP_VERSION}<" in page
    health = json.loads(server.request("GET", "/api/health", token=False)[2])
    assert health["version"] == mw.APP_VERSION


@pytest.mark.parametrize("path,content_type", [
    ("/static/css/app.css", "text/css"),
    ("/static/js/main.js", "text/javascript"),
    ("/static/js/core/cleaning.js", "text/javascript"),
    ("/static/js/ui/ai.js", "text/javascript"),
    ("/static/js/workers/analysis.worker.js", "text/javascript"),
    ("/static/js/core/analysis.js", "text/javascript"),
    ("/static/js/core/project.js", "text/javascript"),
    ("/static/js/ui/project.js", "text/javascript"),
    ("/static/js/ui/project-ui.js", "text/javascript"),
])
def test_static_files_are_served_with_their_content_type(server, path, content_type):
    status, headers, body = server.request("GET", path, token=False)
    assert status == 200 and headers["Content-Type"].startswith(content_type)
    assert headers["X-Content-Type-Options"] == "nosniff" and len(body) > 100


@pytest.mark.parametrize("path", [
    "/static/../app.py",
    "/static/%2e%2e/app.py",
    "/static/js/../../app.py",
    "/static/..%2fapp.py",
    "/static/css/../../manuscript_workbench/server.py",
    "/static/index.html",        # the raw template has no token; only "/" serves the page
    "/static/js/main.js%00.png",
    "/static/js/package.json",   # only whitelisted file types are served
    "/static/",
    "/static/nope.js",
])
def test_static_route_refuses_everything_else(server, path):
    status, _h, body = server.request("GET", path, token=False)
    assert status == 404, path
    assert b"import" not in body and b"class " not in body


def test_static_files_need_a_valid_host_header(server):
    assert server.request("GET", "/static/css/app.css", headers={"Host": "evil.example"}, token=False)[0] == 403
