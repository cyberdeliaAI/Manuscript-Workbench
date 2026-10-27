"""HTTP helpers shared by the request handler: errors, security headers, JSON/text responses, body parsing."""
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict, Optional

from .config import MAX_JSON_BYTES


class HttpError(Exception):
    """An error with a specific HTTP status that is safe to show to the client."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def content_security_policy(allow_remote_images: bool = False) -> str:
    """CSP for the main page. Remote images stay blocked in the Markdown preview unless the user opts in."""
    images = "img-src 'self' data: https: http:" if allow_remote_images else "img-src 'self' data:"
    return "; ".join([
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        images,
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    ])


HELP_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"


def _send_security_headers(handler: BaseHTTPRequestHandler, extra: Optional[Dict[str, str]] = None) -> None:
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("Cache-Control", "no-store")
    for name, value in (extra or {}).items():
        handler.send_header(name, value)


def json_response(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False, indent=None).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    _send_security_headers(handler)
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler: BaseHTTPRequestHandler, text: str, status: int = 200, content_type: str = "text/plain; charset=utf-8", headers: Optional[Dict[str, str]] = None) -> None:
    bytes_response(handler, text.encode("utf-8"), status, content_type, headers)


def bytes_response(handler: BaseHTTPRequestHandler, body: bytes, status: int = 200, content_type: str = "application/octet-stream", headers: Optional[Dict[str, str]] = None) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    _send_security_headers(handler, headers)
    handler.end_headers()
    handler.wfile.write(body)


def get_json_body(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    content_type = (handler.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        raise HttpError(415, "Content-Type must be application/json.")
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        raise HttpError(400, "Invalid Content-Length header.") from None
    if length < 0:
        raise HttpError(400, "Invalid Content-Length header.")
    if length > MAX_JSON_BYTES:
        raise HttpError(413, "Request is too large.")
    data = handler.rfile.read(length)
    if not data:
        return {}
    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HttpError(400, f"Invalid JSON: {exc}") from None
    if not isinstance(payload, dict):
        raise HttpError(400, "The JSON body must be an object.")
    return payload
