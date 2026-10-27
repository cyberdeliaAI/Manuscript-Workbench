"""Target behaviour for the defects found in the 2026-10-27 analysis.

Every test is a strict xfail: it documents the *desired* behaviour and currently fails. Phase 1 fixes the
code and removes the corresponding marker (strict=True turns an unexpected pass into a failure so a
fixed bug cannot keep its marker by accident).
"""
from __future__ import annotations

import json

import pytest

phase1 = pytest.mark.xfail(strict=True, reason="known issue, fixed in phase 1")


# ---------- preview sanitizer ----------

@phase1
def test_sanitizer_keeps_text_inside_unknown_inline_tags(mw):
    out = mw.sanitize_markdown_html("<p>Hello <b>world</b> and <font color=red>red text</font> end</p>")
    assert "world" in out and "red text" in out and "end" in out


@phase1
@pytest.mark.parametrize("tag", ["input", "wbr", "meta", "link"])
def test_sanitizer_void_tag_does_not_swallow_the_rest(mw, tag):
    out = mw.sanitize_markdown_html(f"<p>a</p><{tag}><p>text AFTER</p>")
    assert "text AFTER" in out


# ---------- URL import / SSRF ----------

@phase1
@pytest.mark.parametrize("host", ["127.1", "2130706433", "0x7f.0.0.1", "0177.0.0.1"])
def test_numeric_loopback_spellings_are_refused(mw, host):
    with pytest.raises(ValueError):
        mw.validate_import_url(f"http://{host}:8765/")


# ---------- HTTP hardening ----------

@phase1
def test_foreign_origin_is_rejected(server):
    status, _h, _b = server.request("POST", "/api/preflight", body={"text": "x", "metadata": {}},
                                    headers={"Origin": "http://evil.example"})
    assert status == 403


@phase1
def test_foreign_host_header_is_rejected(server):
    status, _h, _b = server.request("GET", "/api/health", headers={"Host": "evil.example:8765"})
    assert status == 403


@phase1
def test_text_plain_content_type_is_rejected(server):
    status, _h, _b = server.request("POST", "/api/preflight", raw_body=b'{"text":"x","metadata":{}}',
                                    headers={"Content-Type": "text/plain"})
    assert status in (400, 415)


@phase1
def test_invalid_json_is_a_client_error_not_a_server_error(server):
    status, _h, _b = server.request("POST", "/api/preflight", raw_body=b"{not json", headers={"Content-Type": "application/json"})
    assert status == 400


@phase1
def test_api_key_is_never_stored_or_returned(server):
    server.request("POST", "/api/settings", body={"settings": {"lmBase": "http://localhost:1234/v1", "lmApiKey": "TEST-FAKE-KEY"}})
    assert "TEST-FAKE-KEY" not in server.settings_path.read_text(encoding="utf-8")
    _s, _h, body = server.request("GET", "/api/settings")
    assert b"TEST-FAKE-KEY" not in body


# ---------- AI stream ----------

@phase1
def test_think_tags_split_over_chunks_are_stripped(server, mock_provider):
    mock_provider.models.append("think-split")
    body = {"base_url": mock_provider.base_url, "provider": "custom", "model": "think-split", "prompt": "s", "input": "u", "options": {}}
    _s, _h, data = server.request("POST", "/api/lm_stream", body=body)
    text = data.decode()
    assert "hidden" not in text and "Visible" in text
