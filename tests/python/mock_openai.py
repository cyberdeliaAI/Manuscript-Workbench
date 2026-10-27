"""Minimal OpenAI-compatible mock provider for tests (stdlib only).

The requested model name selects the scenario:

  normal       "Hello world", finish_reason stop
  think        "<think>secret</think>Answer"
  think-split  think tags split over chunk boundaries ("<thi" | "nk>...")
  reasoning    reasoning_content deltas first, then content "Final"
  length       "Partial" with finish_reason length
  abort        a few deltas, then the connection is dropped mid-chunk (no [DONE])
  slow         many deltas with a delay; records whether the client went away
  error500     HTTP 500 with a text body
"""
from __future__ import annotations

import json
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional


def _chunk(delta: Dict[str, Any], finish: Optional[str] = None) -> str:
    return json.dumps({"choices": [{"index": 0, "delta": delta, "finish_reason": finish}]})


SCENARIOS: Dict[str, List[Any]] = {
    "normal": [{"content": "Hello"}, {"content": " "}, {"content": "world"}, ("finish", "stop")],
    "think": [{"content": "<think>secret</think>"}, {"content": "Answer"}, ("finish", "stop")],
    "think-split": [{"content": "<thi"}, {"content": "nk>hidden"}, {"content": "</thi"}, {"content": "nk>Visible"}, ("finish", "stop")],
    "reasoning": [{"reasoning_content": "thinking one "}, {"reasoning_content": "thinking two"}, {"content": "Final"}, ("finish", "stop")],
    "length": [{"content": "Partial"}, ("finish", "length")],
}


class MockOpenAI:
    def __init__(self, api_key: Optional[str] = None, models: Optional[List[str]] = None) -> None:
        self.requests: List[Dict[str, Any]] = []
        self.api_key = api_key
        self.models = models or ["normal"]
        self.slow_client_gone = threading.Event()
        self.slow_started = threading.Event()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args: Any) -> None:
                pass

            def _auth_ok(self) -> bool:
                if outer.api_key is None:
                    return True
                return self.headers.get("Authorization") == f"Bearer {outer.api_key}"

            def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                outer.requests.append({"method": "GET", "path": self.path, "headers": dict(self.headers)})
                if not self._auth_ok():
                    self._send(401, b'{"error":"API key required"}')
                    return
                if self.path.rstrip("/") == "/v1/models":
                    self._send(200, json.dumps({"data": [{"id": m} for m in outer.models]}).encode())
                else:
                    self._send(404, b"not found", "text/plain")

            def _write_chunk(self, payload: str) -> None:
                data = payload.encode("utf-8")
                self.wfile.write(f"{len(data):x}\r\n".encode() + data + b"\r\n")
                self.wfile.flush()

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                outer.requests.append({"method": "POST", "path": self.path, "headers": dict(self.headers), "body": body})
                if not self._auth_ok():
                    self._send(401, b'{"error":"API key required"}')
                    return
                scenario = body.get("model", "normal")
                if scenario == "error500":
                    self._send(500, b"provider exploded", "text/plain")
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Transfer-Encoding", "chunked")
                self.end_headers()
                try:
                    if scenario == "abort":
                        self._write_chunk("data: " + _chunk({"content": "Part"}) + "\n\n")
                        self._write_chunk("data: " + _chunk({"content": "ial"}) + "\n\n")
                        time.sleep(0.05)
                        self.connection.shutdown(socket.SHUT_RDWR)
                        return
                    if scenario == "slow":
                        outer.slow_started.set()
                        for i in range(200):
                            self._write_chunk("data: " + _chunk({"reasoning_content": f"r{i} "}) + "\n\n")
                            time.sleep(0.05)
                        self._write_chunk("data: [DONE]\n\n")
                        self.wfile.write(b"0\r\n\r\n")
                        return
                    for item in SCENARIOS.get(scenario, SCENARIOS["normal"]):
                        if isinstance(item, tuple):
                            self._write_chunk("data: " + _chunk({}, item[1]) + "\n\n")
                        else:
                            self._write_chunk("data: " + _chunk(item) + "\n\n")
                    self._write_chunk("data: [DONE]\n\n")
                    self.wfile.write(b"0\r\n\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    if scenario == "slow":
                        outer.slow_client_gone.set()

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.port = self._server.server_address[1]
        self.base_url = f"http://127.0.0.1:{self.port}/v1"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def start(self) -> "MockOpenAI":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()
