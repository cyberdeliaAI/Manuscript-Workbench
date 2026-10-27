"""Helpers for talking to OpenAI-compatible AI providers."""
from __future__ import annotations

import re
import urllib.parse
from typing import Dict, List

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
