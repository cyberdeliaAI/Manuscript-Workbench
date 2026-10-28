"""The local HTTP server and request handler."""
from __future__ import annotations

import base64
import datetime as _dt
import errno
import hmac
import json
import re
import secrets
import sys
import time
import traceback
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict

from .ai import ThinkStripper, ai_request_headers, normalize_base_url, validate_ai_base_url
from .config import APP_HOST, APP_NAME, APP_PORT, APP_VERSION, INDEX_PATH, STATIC_DIR, USER_GUIDE_PATH
from .deps import Document, lxml_html, markdown_lib, requests, trafilatura
from .docx_export import create_manuscript_docx
from .htmlimport import html_import_options
from .http_util import HELP_CSP, HttpError, _send_security_headers, bytes_response, content_security_policy, get_json_body, json_response, text_response
from .importers import import_file
from .mdrender import render_help_page, render_markdown_html
from .netsafe import fetch_url_bytes
from . import project
from .preflight import preflight
from .settings import read_app_settings, scrub_stored_secrets, settings_path, write_app_settings
from .textio import decode_text_bytes, normalize_imported_text, safe_filename


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # Required on every /api request (except /api/health). It is only handed out through the index page,
        # which browsers on other origins cannot read, so a foreign web page cannot drive the API.
        self.session_token = secrets.token_urlsafe(32)

    def handle_error(self, request: Any, client_address: Any) -> None:
        # Browsers reset connections all the time (closed tab, Stop button); that is not worth a traceback.
        if isinstance(sys.exc_info()[1], (ConnectionResetError, BrokenPipeError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


LOCAL_HOST_NAMES = ("127.0.0.1", "localhost", "[::1]")

STATIC_CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


class ManuscriptWorkbenchHandler(BaseHTTPRequestHandler):
    server_version = "ManuscriptWorkbenchHTTP/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[%s] %s\n" % (_dt.datetime.now().strftime("%H:%M:%S"), fmt % args))

    # ---- request guards -------------------------------------------------------------------------

    def _host_allowed(self) -> bool:
        """Only accept our own loopback names and port: this defeats DNS-rebinding attacks."""
        raw = (self.headers.get("Host") or "").strip().lower()
        if raw.startswith("["):
            end = raw.find("]")
            if end == -1:
                return False
            host, rest = raw[:end + 1], raw[end + 1:]
            if rest and not rest.startswith(":"):
                return False
            port_text = rest[1:]
        else:
            host, _sep, port_text = raw.partition(":")
        try:
            port = int(port_text) if port_text else 80
        except ValueError:
            return False
        return host in LOCAL_HOST_NAMES and port == self.server.server_address[1]

    def _origin_allowed(self, origin: str) -> bool:
        try:
            parsed = urllib.parse.urlparse(origin)
            port = parsed.port or 80
        except ValueError:
            return False
        host = (parsed.hostname or "").lower()
        return parsed.scheme == "http" and host in ("127.0.0.1", "localhost", "::1") and port == self.server.server_address[1]

    def _guard(self, path: str) -> None:
        if not self._host_allowed():
            raise HttpError(403, "Forbidden: unexpected Host header.")
        origin = self.headers.get("Origin")
        if origin is not None and not self._origin_allowed(origin):
            raise HttpError(403, "Forbidden: cross-origin requests are not allowed.")
        if path.startswith("/api/") and path != "/api/health":
            supplied = (self.headers.get("X-MW-Token") or "").encode("utf-8")
            if not hmac.compare_digest(supplied, self.server.session_token.encode("utf-8")):
                raise HttpError(403, "Missing or invalid session token. Reload the page.")

    def _send_http_error(self, exc: HttpError) -> None:
        body = {"error": exc.message}
        if exc.code:
            body["code"] = exc.code
        json_response(self, body, status=exc.status)

    # ---- verbs ----------------------------------------------------------------------------------

    def do_OPTIONS(self) -> None:
        # The app never makes cross-origin requests, so no CORS headers are ever sent.
        try:
            self._guard("/")
        except HttpError as exc:
            self._send_http_error(exc)
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        _send_security_headers(self)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            self._guard(parsed.path)
            self._route_get(parsed.path)
        except HttpError as exc:
            self._send_http_error(exc)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            traceback.print_exc()
            json_response(self, {"error": str(exc)}, status=500)

    def _route_get(self, path: str) -> None:
        if path in ("/", "/index.html"):
            stored = read_app_settings().get("settings")
            allow_images = bool(stored.get("allowRemoteImages")) if isinstance(stored, dict) else False
            page = INDEX_PATH.read_text(encoding="utf-8").replace('name="mw-token" content=""', f'name="mw-token" content="{self.server.session_token}"', 1)
            text_response(self, page, content_type="text/html; charset=utf-8",
                          headers={"Content-Security-Policy": content_security_policy(allow_images), "X-Frame-Options": "DENY"})
        elif path.startswith("/static/"):
            self._serve_static(path[len("/static/"):])
        elif path == "/api/health":
            json_response(self, {"ok": True, "app": APP_NAME, "version": APP_VERSION, "python_docx": Document is not None, "requests": requests is not None, "markdown": markdown_lib is not None, "lxml": lxml_html is not None, "trafilatura": trafilatura is not None})
        elif path == "/api/settings":
            json_response(self, read_app_settings())
        elif path == "/help":
            guide = USER_GUIDE_PATH
            if guide.exists():
                text_response(self, render_help_page(guide.read_text(encoding="utf-8")), content_type="text/html; charset=utf-8",
                              headers={"Content-Security-Policy": HELP_CSP, "X-Frame-Options": "DENY"})
            else:
                text_response(self, "User guide not found.", HTTPStatus.NOT_FOUND)
        elif path == "/USER_GUIDE.md":
            guide = USER_GUIDE_PATH
            if guide.exists():
                text_response(self, guide.read_text(encoding="utf-8"), content_type="text/markdown; charset=utf-8")
            else:
                text_response(self, "User guide not found.", HTTPStatus.NOT_FOUND)
        else:
            text_response(self, "Not found", HTTPStatus.NOT_FOUND)

    def _serve_static(self, relative: str) -> None:
        """Serve a file from static/. Only whitelisted file types, and never anything outside the static folder."""
        root = STATIC_DIR.resolve()
        try:
            target = (root / urllib.parse.unquote(relative)).resolve()
        except (OSError, ValueError):
            raise HttpError(404, "Not found.") from None
        content_type = STATIC_CONTENT_TYPES.get(target.suffix.lower())
        if content_type is None or root not in target.parents or not target.is_file():
            raise HttpError(404, "Not found.")
        bytes_response(self, target.read_bytes(), content_type=content_type)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        self._streaming_response_started = False
        try:
            self._guard(parsed.path)
            self._route_post(parsed.path)
        except HttpError as exc:
            if not self._streaming_response_started:
                self._send_http_error(exc)
        except ValueError as exc:
            # ValueError is how the helpers report bad user input (unsupported file, blocked URL, ...).
            if not self._streaming_response_started:
                json_response(self, {"error": str(exc)}, status=400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            traceback.print_exc()
            if self._streaming_response_started:
                return
            json_response(self, {"error": str(exc)}, status=500)

    def _route_post(self, path: str) -> None:
        if path == "/api/import":
            payload = get_json_body(self)
            filename = payload.get("filename") or "untitled.txt"
            data = base64.b64decode(payload.get("data_b64") or "")
            json_response(self, import_file(filename, data, payload.get("html_mode") or "simple"))
        elif path == "/api/import_html_options":
            payload = get_json_body(self)
            filename = payload.get("filename") or "import.html"
            data = base64.b64decode(payload.get("data_b64") or "")
            decoded, notes = decode_text_bytes(data)
            result = html_import_options(decoded, filename=filename)
            result["notes"] = notes + result.get("notes", [])
            json_response(self, result)
        elif path == "/api/import_url":
            payload = get_json_body(self)
            data, final_url, content_type = fetch_url_bytes(payload.get("url") or "")
            decoded, notes = decode_text_bytes(data)
            parsed_url = urllib.parse.urlparse(final_url)
            path_name = Path(urllib.parse.unquote(parsed_url.path or "")).name or (parsed_url.hostname or "import")
            filename = safe_filename(path_name.rsplit(".", 1)[0] or parsed_url.hostname or "url-import") + ".md"
            if "html" in content_type.lower() or re.search(r"<(?:!doctype\s+html|html|head|body|article|main)\b", decoded, re.I):
                result = html_import_options(decoded, filename=filename, url=final_url)
            else:
                text = normalize_imported_text(decoded)
                result = {
                    "filename": filename,
                    "url": final_url,
                    "simple": {"text": text, "chars": len(text)},
                    "main": {"text": "", "chars": 0, "error": "URL did not look like HTML."},
                    "notes": ["Imported URL as text"],
                    "engine": "text",
                }
            result["content_type"] = content_type
            result["notes"] = notes + result.get("notes", [])
            json_response(self, result)
        elif path == "/api/render_markdown":
            payload = get_json_body(self)
            json_response(self, {"html": render_markdown_html(payload.get("text") or ""), "engine": "python-markdown"})
        elif path == "/api/settings":
            payload = get_json_body(self)
            settings = payload.get("settings") if isinstance(payload.get("settings"), dict) else payload
            write_app_settings(settings)
            json_response(self, {"ok": True, "path": str(settings_path())})
        elif path == "/api/export_docx":
            payload = get_json_body(self)
            text = payload.get("text") or ""
            metadata = payload.get("metadata") or {}
            docx_bytes = create_manuscript_docx(text, metadata)
            filename = safe_filename(payload.get("filename") or metadata.get("filename") or "manuscript") + "-formatted.docx"
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(docx_bytes)))
            _send_security_headers(self)
            self.end_headers()
            self.wfile.write(docx_bytes)
        elif path == "/api/preflight":
            payload = get_json_body(self)
            json_response(self, preflight(payload.get("text") or "", payload.get("metadata") or {}, payload.get("ignored_candidates")))
        elif path.startswith("/api/projects/"):
            self._route_projects(path[len("/api/projects/"):])
        elif path == "/api/lm_models":
            self.handle_lm_models()
        elif path == "/api/lm_stream":
            self.handle_lm_stream()
        else:
            text_response(self, "Not found", HTTPStatus.NOT_FOUND)

    # ---- projects and snapshots -------------------------------------------------------------------

    def _route_projects(self, action: str) -> None:
        payload = get_json_body(self)
        pid = payload.get("id")
        if action == "list":
            json_response(self, {"projects": project.list_projects(), "dir": str(project.projects_dir())})
        elif action == "open":
            json_response(self, {"project": project.read_project(pid)})
        elif action == "save":
            saved = project.save_project(
                payload.get("name") or "",
                payload.get("project"),
                project_id=pid or None,
                base_updated_at=payload.get("baseUpdatedAt"),
                create_only=bool(payload.get("createOnly")),
                force=bool(payload.get("force")),
                periodic_snapshot=bool(payload.get("periodicSnapshot")),
            )
            json_response(self, {"saved": saved})
        elif action == "delete":
            project.delete_project(pid)
            json_response(self, {"ok": True})
        elif action == "snapshots/list":
            json_response(self, {"snapshots": project.list_snapshots(pid)})
        elif action == "snapshots/create":
            snapshot = project.create_snapshot(pid, payload.get("text"), kind=payload.get("kind") or "manual",
                                               label=payload.get("label") or "", reason=payload.get("reason") or "")
            json_response(self, {"snapshot": snapshot})
        elif action == "snapshots/get":
            json_response(self, {"snapshot": project.get_snapshot(pid, payload.get("snapshotId"))})
        elif action == "snapshots/restore":
            json_response(self, project.restore_snapshot(pid, payload.get("snapshotId"), payload.get("currentText")))
        elif action == "snapshots/delete":
            project.delete_snapshot(pid, payload.get("snapshotId"))
            json_response(self, {"ok": True})
        else:
            text_response(self, "Not found", HTTPStatus.NOT_FOUND)

    # ---- AI provider proxy ----------------------------------------------------------------------

    def handle_lm_models(self) -> None:
        if requests is None:
            raise RuntimeError("requests is not installed. Run: pip install -r requirements.txt")
        payload = get_json_body(self)
        base_url = validate_ai_base_url(normalize_base_url(payload.get("base_url") or "", payload.get("provider") or "lmstudio"))
        resp = requests.get(f"{base_url}/models", headers=ai_request_headers(payload.get("api_key") or ""), timeout=8)
        resp.raise_for_status()
        data = resp.json()
        models = [m.get("id") for m in data.get("data", []) if m.get("id")]
        json_response(self, {"models": models, "base_url": base_url})

    def _emit(self, event: Dict[str, Any]) -> None:
        self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"))
        self.wfile.flush()

    def handle_lm_stream(self) -> None:
        """Proxy a chat completion and re-frame it as newline-delimited JSON events:

        {"t":"delta","text":...}  visible text            {"t":"reasoning"} / {"t":"ping"}  keep-alive while waiting
        {"t":"finish","reason":...}  provider finish_reason   {"t":"done"}  the stream ended cleanly
        {"t":"error","message":...}  the stream failed. A stream without "done" is always incomplete.
        """
        if requests is None:
            raise RuntimeError("requests is not installed. Run: pip install -r requirements.txt")
        payload = get_json_body(self)
        base_url = validate_ai_base_url(normalize_base_url(payload.get("base_url") or "", payload.get("provider") or "lmstudio"))
        headers = ai_request_headers(payload.get("api_key") or "")
        model = (payload.get("model") or "").strip()
        if not model:
            try:
                resp = requests.get(f"{base_url}/models", headers=headers, timeout=6)
                resp.raise_for_status()
                models = resp.json().get("data") or []
                if models:
                    model = (models[0].get("id") or "").strip()
            except Exception:
                pass
        model = model or "local-model"
        system_prompt = payload.get("prompt") or "Rewrite the text. Output only the result."
        input_text = payload.get("input") or ""
        body = {
            "model": model,
            "stream": True,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": input_text},
            ],
        }
        options = payload.get("options") or {}
        if isinstance(options, dict):
            for key in ("temperature", "top_p", "top_k", "repeat_penalty", "max_tokens"):
                value = options.get(key)
                if value is not None and value != "":
                    body[key] = value

        stripper = ThinkStripper()
        finished = False
        done = False
        last_write = time.monotonic()
        with requests.post(f"{base_url}/chat/completions", json=body, headers=headers, stream=True, timeout=(10, 300)) as resp:
            if resp.status_code >= 400:
                raise RuntimeError(resp.text[:4000])
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            _send_security_headers(self)
            self.end_headers()
            self._streaming_response_started = True
            try:
                for raw in resp.iter_lines(decode_unicode=False):
                    now = time.monotonic()
                    line = raw.decode("utf-8", errors="replace").strip() if raw else ""
                    if not line or line.startswith(":"):
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if line == "[DONE]":
                        done = True
                        break
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(data, dict):
                        continue
                    if data.get("error"):
                        err = data["error"]
                        message = err.get("message") if isinstance(err, dict) else str(err)
                        self._emit({"t": "error", "message": message or "The AI provider reported an error."})
                        return
                    choice = (data.get("choices") or [{}])[0] or {}
                    delta = choice.get("delta") or {}
                    content = delta.get("content")
                    if content is None:
                        content = (choice.get("message") or {}).get("content")
                    wrote = False
                    if isinstance(content, str) and content:
                        visible = stripper.feed(content)
                        if visible:
                            self._emit({"t": "delta", "text": visible})
                            wrote = True
                    finish_reason = choice.get("finish_reason")
                    if finish_reason:
                        rest = stripper.flush()
                        if rest:
                            self._emit({"t": "delta", "text": rest})
                        self._emit({"t": "finish", "reason": str(finish_reason)})
                        finished = True
                        wrote = True
                    if wrote:
                        last_write = now
                    elif now - last_write >= 1.0:
                        # Nothing visible for a while (a reasoning model is thinking). Writing a line also lets us
                        # notice a closed browser connection, so leaving this block stops the provider's generation.
                        kind = "reasoning" if (delta.get("reasoning_content") or delta.get("reasoning")) else "ping"
                        self._emit({"t": kind})
                        last_write = now
                rest = stripper.flush()
                if rest:
                    self._emit({"t": "delta", "text": rest})
                if done or finished:
                    self._emit({"t": "done"})
                else:
                    self._emit({"t": "error", "message": "The AI provider closed the stream before it finished. The output is incomplete."})
            except (BrokenPipeError, ConnectionResetError):
                return  # the browser went away; closing the provider connection (end of `with`) stops generation
            except requests.RequestException as exc:
                try:
                    self._emit({"t": "error", "message": f"The connection to the AI provider was lost: {exc}"})
                except (BrokenPipeError, ConnectionResetError):
                    pass


def main() -> int:
    missing = []
    if Document is None:
        missing.append("python-docx")
    if requests is None:
        missing.append("requests")
    if markdown_lib is None:
        missing.append("markdown")
    if missing:
        print("Missing dependencies:", ", ".join(missing))
        print("Run: pip install -r requirements.txt")
        return 2
    if scrub_stored_secrets():
        print("Note: an API key saved by an older version was removed from the settings file. It now stays in the browser only.")
    url = f"http://{APP_HOST}:{APP_PORT}"
    try:
        server = ReusableThreadingHTTPServer((APP_HOST, APP_PORT), ManuscriptWorkbenchHandler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(f"{APP_NAME}")
            print(f"Port {APP_PORT} is already in use.")
            print(f"If Manuscript Workbench is already open, use: {url}")
            print(f"To start another copy, run: MANUSCRIPT_WORKBENCH_PORT={APP_PORT + 1} ./start_mac_linux.sh")
            return 1
        raise
    print(f"{APP_NAME}")
    print(f"Open: {url}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
        server.server_close()
    return 0
