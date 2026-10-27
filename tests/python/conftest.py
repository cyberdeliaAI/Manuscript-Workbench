from __future__ import annotations

import http.client
import json
import os
import pathlib
import threading
from typing import Any, Dict, Optional, Tuple

import pytest

# Never route test traffic (loopback) through a proxy configured in the environment.
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

from legacy_loader import load_legacy_app  # noqa: E402
from mock_openai import MockOpenAI  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures"


@pytest.fixture(scope="session")
def mw():
    """The implementation under test (the legacy single-file app until phase 2)."""
    return load_legacy_app()


@pytest.fixture(scope="session")
def corpus() -> Dict[str, str]:
    return json.loads((FIXTURES / "corpus.json").read_text(encoding="utf-8"))


class LiveServer:
    def __init__(self, host: str, port: int, settings_path: pathlib.Path, token: str) -> None:
        self.host = host
        self.port = port
        self.settings_path = settings_path
        self.token = token

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        headers: Optional[Dict[str, str]] = None,
        raw_body: Optional[bytes] = None,
        token: bool = True,
    ) -> Tuple[int, Dict[str, str], bytes]:
        hdrs = dict(headers or {})
        if token and "X-MW-Token" not in hdrs:
            hdrs["X-MW-Token"] = self.token
        payload: Optional[bytes] = raw_body
        if payload is None and body is not None:
            payload = json.dumps(body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
        conn = http.client.HTTPConnection(self.host, self.port, timeout=15)
        conn.request(method, path, body=payload, headers=hdrs)
        resp = conn.getresponse()
        data = resp.read()
        out_headers = {k: v for k, v in resp.getheaders()}
        conn.close()
        return resp.status, out_headers, data


@pytest.fixture
def server(mw, tmp_path, monkeypatch):
    """The real request handler on an ephemeral loopback port; settings go to tmp_path."""
    settings_path = tmp_path / "manuscript_workbench_settings.json"
    monkeypatch.setattr(mw, "SETTINGS_PATH", settings_path)
    srv = mw.ReusableThreadingHTTPServer(("127.0.0.1", 0), mw.ManuscriptWorkbenchHandler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    host, port = srv.server_address[:2]
    try:
        yield LiveServer(host, port, settings_path, srv.session_token)
    finally:
        srv.shutdown()
        srv.server_close()


@pytest.fixture
def mock_provider():
    provider = MockOpenAI(models=["normal", "think", "reasoning"]).start()
    try:
        yield provider
    finally:
        provider.stop()
