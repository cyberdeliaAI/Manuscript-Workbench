"""The server as the Electron desktop app runs it: free port, ready line on stdout, stop through stdin."""
from __future__ import annotations

import http.client
import json
import os
import pathlib
import socket
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def start(tmp_path, *args):
    env = dict(os.environ, MANUSCRIPT_WORKBENCH_DATA_DIR=str(tmp_path), PYTHONDONTWRITEBYTECODE="1")
    return subprocess.Popen(
        [sys.executable, "-m", "manuscript_workbench.desktop_host", *args],
        cwd=ROOT, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )


def ready(process):
    return json.loads(process.stdout.readline())


def get(url, path):
    host, port = url.removeprefix("http://").split(":")
    connection = http.client.HTTPConnection(host, int(port), timeout=10)
    connection.request("GET", path)
    response = connection.getresponse()
    return response.status, response.read()


def test_reports_a_free_loopback_port_and_serves_the_app(tmp_path, mw):
    process = start(tmp_path)
    try:
        event = ready(process)
        assert event["event"] == "ready" and event["protocol"] == 1 and event["version"] == mw.APP_VERSION
        assert event["url"].startswith("http://127.0.0.1:") and int(event["url"].rsplit(":", 1)[1]) > 0
        status, body = get(event["url"], "/api/health")
        assert status == 200 and json.loads(body)["version"] == mw.APP_VERSION
        status, page = get(event["url"], "/")
        assert status == 200 and b'name="mw-token"' in page
    finally:
        process.kill()
        process.wait()


def test_the_stop_line_ends_the_server_cleanly(tmp_path):
    process = start(tmp_path)
    ready(process)
    process.stdin.write("stop\n")
    process.stdin.flush()
    assert process.wait(timeout=15) == 0


def test_the_end_of_stdin_stops_the_server_too(tmp_path):
    process = start(tmp_path)
    ready(process)
    process.stdin.close()  # what happens when Electron crashes
    assert process.wait(timeout=15) == 0


def test_a_busy_port_is_reported_instead_of_taken(tmp_path):
    with socket.socket() as blocker:
        blocker.bind(("127.0.0.1", 0))
        blocker.listen()
        busy = blocker.getsockname()[1]
        process = start(tmp_path, "--port", str(busy))
        event = ready(process)
        assert event["event"] == "error" and event["code"] == "port"
        assert process.wait(timeout=15) == 1


def test_settings_and_projects_live_in_the_data_folder(tmp_path):
    process = start(tmp_path)
    try:
        url = ready(process)["url"]
        host, port = url.removeprefix("http://").split(":")
        page = get(url, "/")[1].decode()
        token = page.split('name="mw-token" content="')[1].split('"')[0]
        connection = http.client.HTTPConnection(host, int(port), timeout=10)
        connection.request("POST", "/api/settings", body=json.dumps({"settings": {"wrap": True}}),
                           headers={"Content-Type": "application/json", "X-MW-Token": token})
        assert connection.getresponse().status == 200
        assert (tmp_path / "manuscript_workbench_settings.json").exists()
    finally:
        process.kill()
        process.wait()
