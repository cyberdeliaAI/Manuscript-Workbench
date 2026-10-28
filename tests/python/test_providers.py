"""What the app learns about the AI provider: model lists, LM Studio's details, errors, reasoning progress."""
from __future__ import annotations

import json
import socket

import pytest

from mock_openai import MockOpenAI


def models(server, mock, **extra):
    body = {"base_url": mock.base_url, "provider": "lmstudio"}
    body.update(extra)
    status, _h, raw = server.request("POST", "/api/lm_models", body=body)
    return status, json.loads(raw)


def events(body: bytes):
    return [json.loads(line) for line in body.decode("utf-8").splitlines() if line.strip()]


# ---- parsing ------------------------------------------------------------------------------------

def test_openai_model_list_keeps_the_context_length_when_the_provider_reports_it(mw):
    parsed = mw.parse_openai_models({"data": [
        {"id": "plain"},
        {"id": "vllm-style", "max_model_len": 32768},
        {"id": "openrouter-style", "context_length": "8192"},
        {"id": "bad", "context_length": -5},
        {"nameless": True},
        "junk",
    ]})
    assert parsed == [
        {"id": "plain"},
        {"id": "vllm-style", "contextLength": 32768},
        {"id": "openrouter-style", "contextLength": 8192},
        {"id": "bad"},
    ]
    assert mw.parse_openai_models(None) == [] and mw.parse_openai_models({"data": "x"}) == []


def test_lmstudio_v0_model_list(mw):
    details = mw.parse_lmstudio_models({"object": "list", "data": [
        {"id": "qwen", "type": "llm", "state": "loaded", "loaded_context_length": 8192, "max_context_length": 32768, "quantization": "Q4_K_M"},
        {"id": "gemma", "type": "vlm", "state": "not-loaded", "max_context_length": 131072},
        {"id": "embed", "type": "embeddings", "state": "not-loaded"},
    ]})
    assert details["qwen"] == {"type": "llm", "loaded": True, "contextLength": 8192, "maxContextLength": 32768, "quantization": "Q4_K_M"}
    assert details["gemma"] == {"type": "vlm", "loaded": False, "maxContextLength": 131072}
    assert details["embed"] == {"type": "embeddings", "loaded": False}


def test_lmstudio_newer_model_list_shape_is_read_too(mw):
    details = mw.parse_lmstudio_models({"models": [
        {"key": "llama", "type": "llm", "max_context_length": 4096, "loaded_instances": [{"config": {"context_length": 2048}}], "quantization": {"name": "Q8_0", "bits_per_weight": 8}},
        {"key": "idle", "type": "llm", "loaded_instances": []},
    ]})
    assert details["llama"] == {"type": "llm", "loaded": True, "contextLength": 2048, "maxContextLength": 4096, "quantization": "Q8_0"}
    assert details["idle"] == {"type": "llm", "loaded": False}


def test_lmstudio_parser_survives_junk(mw):
    assert mw.parse_lmstudio_models(None) == {} and mw.parse_lmstudio_models({"data": [1, None, {"no": "id"}]}) == {}


def test_provider_root_url_drops_the_v1(mw):
    assert mw.provider_root_url("http://localhost:1234/v1") == "http://localhost:1234"
    assert mw.provider_root_url("http://localhost:1234") == "http://localhost:1234"


# ---- /api/lm_models -------------------------------------------------------------------------------

def test_models_without_extras_still_work(server, mock_provider):
    status, data = models(server, mock_provider, provider="custom")
    assert status == 200 and data["models"] == ["normal", "think", "reasoning"]
    assert data["details"] == {} and data["lmstudioApi"] is False


def test_lmstudio_details_are_merged_into_the_answer(server):
    provider = MockOpenAI(models=["qwen", "embed"], lmstudio_models=[
        {"id": "qwen", "type": "llm", "state": "loaded", "loaded_context_length": 8192, "max_context_length": 32768},
        {"id": "embed", "type": "embeddings", "state": "not-loaded"},
    ]).start()
    try:
        status, data = models(server, provider)
    finally:
        provider.stop()
    assert status == 200 and data["lmstudioApi"] is True and data["models"] == ["qwen", "embed"]
    assert data["details"]["qwen"]["contextLength"] == 8192 and data["details"]["qwen"]["loaded"] is True
    assert data["details"]["embed"]["type"] == "embeddings"


def test_lmstudio_without_its_own_endpoint_falls_back_to_the_plain_list(server):
    provider = MockOpenAI(models=["qwen"], model_info={"qwen": {"context_length": 4096}}).start()
    try:
        status, data = models(server, provider)
        asked = [r["path"] for r in provider.requests]
    finally:
        provider.stop()
    assert status == 200 and data["models"] == ["qwen"] and data["lmstudioApi"] is False
    assert data["details"] == {"qwen": {"contextLength": 4096}}
    assert "/api/v0/models" in asked  # it was tried


def test_other_providers_are_not_asked_for_lmstudio_endpoints(server):
    provider = MockOpenAI(models=["m"], lmstudio_models=[{"id": "m", "type": "llm"}]).start()
    try:
        status, data = models(server, provider, provider="omlx")
        asked = [r["path"] for r in provider.requests]
    finally:
        provider.stop()
    assert status == 200 and data["lmstudioApi"] is False
    assert not any(path.startswith("/api/") for path in asked)


def test_refused_key_connection_refused_and_wrong_path_have_plain_messages(server):
    provider = MockOpenAI(api_key="secret").start()
    try:
        status, data = models(server, provider, api_key="wrong")
        assert status == 502 and "API Key" in data["error"]
        status, data = models(server, provider, api_key="secret", base_url=provider.base_url + "/nothing")
        assert status == 502 and "/v1" in data["error"]
    finally:
        provider.stop()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        closed_port = probe.getsockname()[1]
    status, _h, raw = server.request("POST", "/api/lm_models", body={"base_url": f"http://127.0.0.1:{closed_port}/v1", "provider": "custom"})
    assert status == 502 and "Cannot connect" in json.loads(raw)["error"]


def test_stream_with_a_refused_key_says_so(server):
    provider = MockOpenAI(api_key="secret").start()
    try:
        status, _h, raw = server.request("POST", "/api/lm_stream", body={"base_url": provider.base_url, "provider": "custom", "model": "normal", "prompt": "s", "input": "u", "api_key": "wrong"})
    finally:
        provider.stop()
    assert status == 502 and "API Key" in json.loads(raw)["error"]


# ---- reasoning progress -----------------------------------------------------------------------------

def test_reasoning_model_reports_that_it_is_thinking_but_never_what(server, mock_provider):
    body = {"base_url": mock_provider.base_url, "provider": "custom", "model": "reasoning", "prompt": "s", "input": "u"}
    raw = server.request("POST", "/api/lm_stream", body=body)[2]
    evts = events(raw)
    kinds = [e["t"] for e in evts]
    assert "reasoning" in kinds and kinds.index("reasoning") < kinds.index("delta")
    assert next(e for e in evts if e["t"] == "reasoning")["chars"] > 0
    assert b"thinking one" not in raw and b"thinking two" not in raw


def test_think_tags_in_the_content_count_as_thinking_too(server, mock_provider):
    body = {"base_url": mock_provider.base_url, "provider": "custom", "model": "think-split", "prompt": "s", "input": "u"}
    raw = server.request("POST", "/api/lm_stream", body=body)[2]
    assert any(e["t"] == "reasoning" for e in events(raw))
    assert b"hidden" not in raw
