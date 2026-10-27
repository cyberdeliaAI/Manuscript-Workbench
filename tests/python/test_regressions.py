"""Regression tests for the defects found in the 2026-10-27 analysis (security hardening and bug fixes)."""
from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


# ---------- preview sanitizer ----------

def test_sanitizer_keeps_text_inside_unknown_inline_tags(mw):
    out = mw.sanitize_markdown_html("<p>Hello <font color=red>red text</font> and <center>centered</center> end</p>")
    assert "red text" in out and "centered" in out and "end" in out
    assert "<font" not in out and "<center" not in out


def test_sanitizer_allows_common_inline_tags(mw):
    out = mw.sanitize_markdown_html("<p><b>b</b> <i>i</i> <s>s</s> H<sub>2</sub>O x<sup>2</sup> <small>sm</small> <mark>m</mark></p>")
    for tag in ("b", "i", "s", "sub", "sup", "small", "mark"):
        assert f"<{tag}>" in out


@pytest.mark.parametrize("tag", ["input", "wbr", "meta", "link", "source", "col", "area"])
def test_sanitizer_void_tag_does_not_swallow_the_rest(mw, tag):
    out = mw.sanitize_markdown_html(f"<p>a</p><{tag}><p>text AFTER</p>")
    assert "text AFTER" in out and f"<{tag}" not in out


def test_sanitizer_still_drops_dangerous_content_with_its_text(mw):
    out = mw.sanitize_markdown_html("<p>a</p><script>alert('x')</script><style>p{}</style><iframe>fallback</iframe><p>b</p>")
    assert out == "<p>a</p><p>b</p>"


def test_sanitizer_self_closed_svg_does_not_swallow_the_rest(mw):
    assert "after" in mw.sanitize_markdown_html("<p>before</p><svg/><p>after</p>")


# ---------- URL import / SSRF ----------

@pytest.mark.parametrize("host", ["127.1", "2130706433", "0x7f.0.0.1", "0177.0.0.1", "127.0.0.1", "0.0.0.0", "10.1.2.3", "169.254.169.254", "[::1]"])
def test_loopback_and_private_spellings_are_refused_without_dns(mw, host):
    with pytest.raises(ValueError):
        mw.validate_import_url(f"http://{host}:8765/")


def test_hostname_that_resolves_to_a_private_address_is_refused(mw, monkeypatch):
    monkeypatch.setattr(mw, "_resolve_host", lambda host, port: ["10.0.0.5"])
    with pytest.raises(ValueError, match="blocked"):
        mw.validate_import_url("http://intranet.example/")


def test_hostname_with_any_private_answer_is_refused(mw, monkeypatch):
    monkeypatch.setattr(mw, "_resolve_host", lambda host, port: ["93.184.216.34", "127.0.0.1"])
    with pytest.raises(ValueError, match="blocked"):
        mw.validate_import_url("http://mixed.example/")


def test_public_hostname_is_accepted_and_unresolvable_one_is_refused(mw, monkeypatch):
    monkeypatch.setattr(mw, "_resolve_host", lambda host, port: ["93.184.216.34"])
    assert mw.validate_import_url("https://example.com/a") == "https://example.com/a"

    def fail(host, port):
        raise socket.gaierror("nope")

    monkeypatch.setattr(mw, "_resolve_host", fail)
    with pytest.raises(ValueError, match="resolve"):
        mw.validate_import_url("https://does-not-exist.invalid/")


class _Recorder:
    """Two tiny HTTP servers: a redirector and the 'internal' target it redirects to."""

    def __init__(self):
        self.hits = []
        outer = self

        class Target(BaseHTTPRequestHandler):
            def do_GET(self):
                outer.hits.append(self.path)
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(b"INTERNAL")

            def log_message(self, *a):
                pass

        self.target = ThreadingHTTPServer(("127.0.0.1", 0), Target)
        tport = self.target.server_address[1]
        self.location = f"http://127.0.0.1:{tport}/via-redirect"

        class Redirector(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", outer.location)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.redirector = ThreadingHTTPServer(("127.0.0.1", 0), Redirector)
        self.rport = self.redirector.server_address[1]
        for srv in (self.target, self.redirector):
            threading.Thread(target=srv.serve_forever, daemon=True).start()

    def close(self):
        for srv in (self.target, self.redirector):
            srv.shutdown()
            srv.server_close()


def test_redirect_to_a_private_address_is_refused_before_it_is_requested(mw, monkeypatch):
    rec = _Recorder()
    real = mw.validate_import_url
    # Test seam: allow only the redirector itself (it stands in for a "public" site); every other hop uses the real check.
    monkeypatch.setattr(mw, "validate_import_url", lambda url: url if url.startswith(f"http://127.0.0.1:{rec.rport}/") else real(url))
    try:
        with pytest.raises(ValueError, match="blocked"):
            mw.fetch_url_bytes(f"http://127.0.0.1:{rec.rport}/start")
        assert rec.hits == [], "the private redirect target must never be contacted"
    finally:
        rec.close()


def test_redirect_loop_is_cut_off(mw, monkeypatch):
    rec = _Recorder()
    rec.location = f"http://127.0.0.1:{rec.rport}/again"  # the redirector redirects to itself
    monkeypatch.setattr(mw, "validate_import_url", lambda url: url)
    try:
        with pytest.raises(ValueError, match="redirects"):
            mw.fetch_url_bytes(f"http://127.0.0.1:{rec.rport}/start")
    finally:
        rec.close()


# ---------- HTTP hardening ----------

def raw_request(server, request_head: str, body: bytes = b""):
    sock = socket.create_connection((server.host, server.port), timeout=10)
    sock.sendall(request_head.encode() + body)
    data = b""
    while True:
        chunk = sock.recv(65536)
        if not chunk:
            break
        data += chunk
    sock.close()
    status = int(data.split(b" ", 2)[1])
    return status, data


def test_foreign_origin_is_rejected(server):
    status, _h, _b = server.request("POST", "/api/preflight", body={"text": "x", "metadata": {}}, headers={"Origin": "http://evil.example"})
    assert status == 403
    for origin in ("null", "https://127.0.0.1:%d" % server.port, "http://127.0.0.1:1"):
        assert server.request("POST", "/api/preflight", body={"text": "x"}, headers={"Origin": origin})[0] == 403, origin


def test_own_origin_is_accepted(server):
    for origin in (f"http://127.0.0.1:{server.port}", f"http://localhost:{server.port}"):
        status, _h, _b = server.request("POST", "/api/preflight", body={"text": "x", "metadata": {}}, headers={"Origin": origin})
        assert status == 200, origin


def test_foreign_host_header_is_rejected(server):
    for host in ("evil.example:%d" % server.port, "evil.example", "127.0.0.1:1", "127.0.0.1.evil.example:%d" % server.port):
        assert server.request("GET", "/api/health", headers={"Host": host})[0] == 403, host
        assert server.request("GET", "/", headers={"Host": host})[0] == 403, host


def test_loopback_host_names_are_accepted(server):
    for host in (f"127.0.0.1:{server.port}", f"localhost:{server.port}"):
        assert server.request("GET", "/api/health", headers={"Host": host})[0] == 200, host


def test_api_requires_the_session_token(server):
    assert server.request("POST", "/api/preflight", body={"text": "x"}, token=False)[0] == 403
    assert server.request("POST", "/api/preflight", body={"text": "x"}, headers={"X-MW-Token": "wrong"})[0] == 403
    assert server.request("GET", "/api/settings", token=False)[0] == 403
    assert server.request("GET", "/api/health", token=False)[0] == 200  # health check stays open
    assert server.request("GET", "/help", token=False)[0] == 200  # documentation stays open


def test_index_carries_the_token_and_security_headers(server):
    status, headers, body = server.request("GET", "/", token=False)
    assert status == 200
    assert f'name="mw-token" content="{server.token}"'.encode() in body
    csp = headers["Content-Security-Policy"]
    assert "img-src 'self' data:" in csp and "https:" not in csp and "frame-ancestors 'none'" in csp
    assert headers["X-Frame-Options"] == "DENY" and headers["X-Content-Type-Options"] == "nosniff"
    assert "Access-Control-Allow-Origin" not in headers


def test_remote_images_can_be_enabled_through_the_setting(server):
    server.request("POST", "/api/settings", body={"settings": {"allowRemoteImages": True}})
    csp = server.request("GET", "/", token=False)[1]["Content-Security-Policy"]
    assert "img-src 'self' data: https: http:" in csp


def test_options_preflight_never_grants_cross_origin_access(server):
    status, headers, _b = server.request("OPTIONS", "/api/settings", headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "POST"})
    assert status == 403
    status, headers, _b = server.request("OPTIONS", "/api/settings", headers={"Origin": f"http://127.0.0.1:{server.port}"})
    assert status == 204 and "Access-Control-Allow-Origin" not in headers


def test_text_plain_content_type_is_rejected(server):
    status, _h, _b = server.request("POST", "/api/preflight", raw_body=b'{"text":"x","metadata":{}}', headers={"Content-Type": "text/plain"})
    assert status == 415


def test_invalid_input_is_a_client_error_not_a_server_error(server):
    json_ct = {"Content-Type": "application/json"}
    assert server.request("POST", "/api/preflight", raw_body=b"{not json", headers=json_ct)[0] == 400
    assert server.request("POST", "/api/preflight", raw_body=b"[1,2]", headers=json_ct)[0] == 400
    assert server.request("POST", "/api/preflight", raw_body=b"\xff\xfe", headers=json_ct)[0] == 400
    head = (f"POST /api/preflight HTTP/1.1\r\nHost: 127.0.0.1:{server.port}\r\nX-MW-Token: {server.token}\r\n"
            "Content-Type: application/json\r\nContent-Length: abc\r\nConnection: close\r\n\r\n")
    assert raw_request(server, head)[0] == 400
    head = head.replace("Content-Length: abc", "Content-Length: -5")
    assert raw_request(server, head)[0] == 400
    head = head.replace("Content-Length: -5", f"Content-Length: {200 * 1024 * 1024}")
    assert raw_request(server, head)[0] == 413


def test_bad_user_input_to_helpers_is_a_400(server):
    assert server.request("POST", "/api/import_url", body={"url": "http://127.1/"})[0] == 400
    assert server.request("POST", "/api/import_url", body={"url": "file:///etc/passwd"})[0] == 400
    import base64

    status, _h, body = server.request("POST", "/api/import", body={"filename": "a.doc", "data_b64": base64.b64encode(b"x").decode()})
    assert status == 400 and ".doc" in json.loads(body)["error"]


# ---------- API key handling ----------

def test_api_key_is_never_stored_or_returned(server):
    server.request("POST", "/api/settings", body={"settings": {"lmBase": "http://localhost:1234/v1", "lmApiKey": "TEST-FAKE-KEY", "wrap": True}})
    stored = server.settings_path.read_text(encoding="utf-8")
    assert "TEST-FAKE-KEY" not in stored and "lmApiKey" not in stored
    _s, _h, body = server.request("GET", "/api/settings")
    assert b"TEST-FAKE-KEY" not in body
    assert json.loads(body)["settings"]["wrap"] is True


def test_key_written_by_an_older_version_is_scrubbed(mw, tmp_path, monkeypatch):
    path = tmp_path / "manuscript_workbench_settings.json"
    monkeypatch.setattr(mw, "SETTINGS_PATH", path)
    path.write_text(json.dumps({"version": "1.2", "settings": {"lmApiKey": "OLD-KEY", "wrap": True}}), encoding="utf-8")
    assert "OLD-KEY" not in json.dumps(mw.read_app_settings())  # never served, even before the scrub
    assert mw.scrub_stored_secrets() is True
    assert "OLD-KEY" not in path.read_text(encoding="utf-8")
    assert json.loads(path.read_text(encoding="utf-8"))["settings"] == {"wrap": True}
    assert mw.scrub_stored_secrets() is False  # nothing left to scrub
