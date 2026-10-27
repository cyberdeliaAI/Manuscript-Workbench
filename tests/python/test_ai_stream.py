"""The /api/lm_stream proxy: NDJSON framing, reasoning models, incomplete streams, client disconnects."""
from __future__ import annotations

import json
import socket
import time

import pytest


def events(body: bytes):
    return [json.loads(line) for line in body.decode("utf-8").splitlines() if line.strip()]


def text_of(evts):
    return "".join(e["text"] for e in evts if e["t"] == "delta")


def stream(server, provider, model, **extra):
    body = {"base_url": provider.base_url, "provider": "custom", "model": model, "prompt": "sys", "input": "user text", "options": {}}
    body.update(extra)
    return server.request("POST", "/api/lm_stream", body=body)


def test_normal_stream_is_framed_and_ends_with_done(server, mock_provider):
    status, headers, body = stream(server, mock_provider, "normal")
    evts = events(body)
    assert status == 200 and headers["Content-Type"].startswith("application/x-ndjson")
    assert text_of(evts) == "Hello world"
    assert {"t": "finish", "reason": "stop"} in evts
    assert evts[-1] == {"t": "done"}


def test_request_shape_sent_to_the_provider(server, mock_provider):
    stream(server, mock_provider, "normal", options={"temperature": 0.3, "top_k": "", "max_tokens": 50}, api_key="k")
    sent = [r for r in mock_provider.requests if r["method"] == "POST"][-1]
    assert sent["body"]["model"] == "normal" and sent["body"]["stream"] is True
    assert [m["role"] for m in sent["body"]["messages"]] == ["system", "user"]
    assert sent["body"]["temperature"] == 0.3 and sent["body"]["max_tokens"] == 50 and "top_k" not in sent["body"]
    assert sent["headers"]["Authorization"] == "Bearer k"


def test_think_blocks_and_reasoning_content_never_reach_the_text(server, mock_provider):
    assert text_of(events(stream(server, mock_provider, "think")[2])) == "Answer"
    assert text_of(events(stream(server, mock_provider, "reasoning")[2])) == "Final"


def test_think_tags_split_over_chunks_are_stripped(server, mock_provider):
    evts = events(stream(server, mock_provider, "think-split")[2])
    assert text_of(evts) == "Visible"
    assert evts[-1] == {"t": "done"}


def test_length_finish_reason_is_reported(server, mock_provider):
    evts = events(stream(server, mock_provider, "length")[2])
    assert text_of(evts) == "Partial"
    assert {"t": "finish", "reason": "length"} in evts and evts[-1] == {"t": "done"}


def test_provider_http_error_becomes_a_500_before_streaming(server, mock_provider):
    status, _h, body = stream(server, mock_provider, "error500")
    assert status == 500 and "provider exploded" in json.loads(body)["error"]


def test_dropped_provider_connection_is_reported_as_an_error_not_as_done(server, mock_provider):
    status, _h, body = stream(server, mock_provider, "abort")
    evts = events(body)
    assert status == 200
    assert text_of(evts).startswith("Partial")
    assert evts[-1]["t"] == "error" and "lost" in evts[-1]["message"]
    assert not any(e["t"] == "done" for e in evts)


def test_closing_the_browser_connection_stops_the_provider(server, mock_provider):
    sock = socket.create_connection((server.host, server.port), timeout=10)
    payload = json.dumps({"base_url": mock_provider.base_url, "provider": "custom", "model": "slow", "prompt": "s", "input": "u", "options": {}})
    head = (f"POST /api/lm_stream HTTP/1.1\r\nHost: 127.0.0.1:{server.port}\r\nX-MW-Token: {server.token}\r\n"
            f"Content-Type: application/json\r\nContent-Length: {len(payload)}\r\n\r\n")
    sock.sendall(head.encode() + payload.encode())
    assert mock_provider.slow_started.wait(10)
    sock.recv(64)  # first bytes of the response
    sock.close()
    assert mock_provider.slow_client_gone.wait(15), "provider kept generating after the browser disconnected"


def test_endpoint_with_credentials_or_odd_scheme_is_refused(server):
    for base in ("http://user:pw@localhost:1234/v1", "file:///etc/passwd", "ftp://localhost/v1"):
        status, _h, body = server.request("POST", "/api/lm_stream", body={"base_url": base, "provider": "custom", "model": "m", "prompt": "s", "input": "u"})
        assert status == 400, base
        status, _h, _b = server.request("POST", "/api/lm_models", body={"base_url": base, "provider": "custom"})
        assert status == 400, base


@pytest.mark.parametrize("chunks,expected", [
    (["Hello <think>x</think>world"], "Hello world"),
    (["<thi", "nk>hidden</thi", "nk>shown"], "shown"),
    (["a<", "b"], "a<b"),
    (["<THINK>x</THINK>ok"], "ok"),
    (["before <think>never closed"], "before "),
    (["x <thin"], "x <thin"),
])
def test_think_stripper(mw, chunks, expected):
    stripper = mw.ThinkStripper()
    out = "".join(stripper.feed(c) for c in chunks) + stripper.flush()
    assert out == expected
