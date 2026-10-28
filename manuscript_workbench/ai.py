"""Helpers for talking to OpenAI-compatible AI providers."""
from __future__ import annotations

import re
import urllib.parse
from typing import Any, Dict, List

from .http_util import HttpError


AI_PROVIDER_BASE_URLS = {
    "lmstudio": "http://localhost:1234/v1",
    "omlx": "http://localhost:8000/v1",
    "ollama": "http://localhost:11434/v1",
    "custom": "http://localhost:1234/v1",
}


def normalize_base_url(base_url: str, provider: str = "lmstudio") -> str:
    default = AI_PROVIDER_BASE_URLS.get((provider or "").lower(), AI_PROVIDER_BASE_URLS["lmstudio"])
    base = (base_url or default).strip().rstrip("/")
    if base and "://" not in base:
        base = "http://" + base
    if not base.endswith("/v1"):
        # Accept either http://localhost:1234 or http://localhost:1234/v1
        parsed = urllib.parse.urlparse(base)
        if parsed.scheme and parsed.netloc and not parsed.path.rstrip("/").endswith("/v1"):
            base = base + "/v1"
    return base


def validate_ai_base_url(base_url: str) -> str:
    """The AI endpoint may be on the LAN, but it must be a plain http(s) URL without embedded credentials."""
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HttpError(400, "The AI endpoint must be an http:// or https:// URL.")
    if parsed.username or parsed.password:
        raise HttpError(400, "AI endpoints with embedded credentials are not supported; use the API Key field.")
    return base_url


class ThinkStripper:
    """Removes <think>...</think> blocks from a stream, including tags split across chunks."""

    OPEN = "<think>"
    CLOSE = "</think>"

    def __init__(self) -> None:
        self.in_think = False
        self._buf = ""

    @staticmethod
    def _partial_suffix(buf: str, tag: str) -> int:
        """Length of the longest proper prefix of `tag` that `buf` ends with (a possibly incomplete tag)."""
        for size in range(min(len(tag) - 1, len(buf)), 0, -1):
            if buf[-size:].lower() == tag[:size]:
                return size
        return 0

    def feed(self, chunk: str) -> str:
        self._buf += chunk
        out: List[str] = []
        while True:
            tag = self.CLOSE if self.in_think else self.OPEN
            match = re.search(re.escape(tag), self._buf, re.I)
            if match:
                if not self.in_think:
                    out.append(self._buf[:match.start()])
                self._buf = self._buf[match.end():]
                self.in_think = not self.in_think
                continue
            keep = self._partial_suffix(self._buf, tag)
            cut = len(self._buf) - keep
            if not self.in_think:
                out.append(self._buf[:cut])
            self._buf = self._buf[cut:]
            return "".join(out)

    def flush(self) -> str:
        rest = "" if self.in_think else self._buf
        self._buf = ""
        return rest


def ai_request_headers(api_key: str = "") -> Dict[str, str]:
    headers: Dict[str, str] = {}
    key = (api_key or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


# ---- what the provider says about its models -----------------------------------------------------------------

# Names under which providers report how much context a model has (vLLM-style servers, OpenRouter, llama.cpp, LM Studio).
CONTEXT_KEYS = ("max_model_len", "context_length", "context_window", "max_context_length", "n_ctx", "max_context")


def _positive_int(value: Any) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return 0
    return number if number > 0 else 0


def provider_root_url(base_url: str) -> str:
    """The server address without the trailing /v1 (where LM Studio keeps its own /api/... endpoints)."""
    base = base_url.rstrip("/")
    return base[:-3] if base.endswith("/v1") else base


def parse_openai_models(data: Any) -> List[Dict[str, Any]]:
    """The entries of GET /v1/models as [{"id": ..., "contextLength": n}]; contextLength only when the provider says."""
    items = data.get("data") if isinstance(data, dict) else None
    models: List[Dict[str, Any]] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        entry: Dict[str, Any] = {"id": str(item["id"])}
        for key in CONTEXT_KEYS:
            number = _positive_int(item.get(key))
            if number:
                entry["contextLength"] = number
                break
        models.append(entry)
    return models


def parse_lmstudio_models(payload: Any) -> Dict[str, Dict[str, Any]]:
    """Details from LM Studio's own model list (GET /api/v0/models, or the newer /api/v1/models), by model id.

    Both shapes are read leniently, because what a given LM Studio version offers is not guaranteed:
    {"type": "llm" | "vlm" | "embeddings", "loaded": bool, "contextLength": loaded context, "maxContextLength": n,
     "quantization": "Q4_K_M"} with the keys left out when the server does not say.
    """
    items = None
    if isinstance(payload, dict):
        items = payload.get("data") if isinstance(payload.get("data"), list) else payload.get("models")
    details: Dict[str, Dict[str, Any]] = {}
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id") or item.get("key") or item.get("model_key")
        if not model_id:
            continue
        info: Dict[str, Any] = {}
        if isinstance(item.get("type"), str):
            info["type"] = item["type"]
        instances = item.get("loaded_instances")
        if item.get("state") in ("loaded", "not-loaded"):
            info["loaded"] = item["state"] == "loaded"
        elif isinstance(instances, list):
            info["loaded"] = bool(instances)
        loaded_context = _positive_int(item.get("loaded_context_length"))
        if not loaded_context and isinstance(instances, list) and instances and isinstance(instances[0], dict):
            config = instances[0].get("config")
            loaded_context = _positive_int(config.get("context_length")) if isinstance(config, dict) else 0
        if loaded_context:
            info["contextLength"] = loaded_context
        maximum = _positive_int(item.get("max_context_length"))
        if maximum:
            info["maxContextLength"] = maximum
        quantization = item.get("quantization")
        if isinstance(quantization, dict):
            quantization = quantization.get("name")
        if isinstance(quantization, str) and quantization:
            info["quantization"] = quantization
        details[str(model_id)] = info
    return details
