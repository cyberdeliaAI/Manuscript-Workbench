"""Checks of the desktop app, with disposable settings and projects.

  python tools/check_desktop.py backend            the frozen Python server in build/desktop/backend
  python tools/check_desktop.py dev                electron/ run from source (needs `npm ci` in electron/)
  python tools/check_desktop.py app <executable>   a built app (electron/out/...)

`app` and `dev` start the real window, wait for the page, run electron/smoke.cjs inside it, quit, and then check that
the Python server is gone and that a second start reuses the address (so browser storage survives).
"""
from __future__ import annotations

import base64
import http.client
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
SERVER_NAME = "manuscript-workbench-server" + (".exe" if sys.platform == "win32" else "")
APP_VERSION = next(
    line.split('"')[1] for line in (ROOT / "manuscript_workbench" / "config.py").read_text(encoding="utf-8").splitlines()
    if line.startswith("APP_VERSION")
)
ARTICLE = "<html><body><article><h1>A title for the article</h1>" + "".join(
    f"<p>Sentence {i} of an article paragraph that is long enough to survive extraction.</p>" for i in range(12)
) + "</article></body></html>"


def clean_environment(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """The environment of a launched app: no build credentials, no settings of the developer's own."""
    env = {key: value for key, value in os.environ.items() if not key.startswith(("CSC_", "WIN_CSC_", "APPLE_", "MANUSCRIPT_WORKBENCH_"))}
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env.update(extra or {})
    return env


def frozen_server() -> Path:
    return ROOT / "build" / "desktop" / "backend" / "manuscript-workbench-server" / SERVER_NAME


def request(url: str, path: str, body: Optional[dict] = None, token: str = "") -> http.client.HTTPResponse:
    headers = {"X-MW-Token": token}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    return urllib.request.urlopen(urllib.request.Request(url + path, data=data, headers=headers), timeout=30)


def check_backend(server: Path) -> None:
    """The frozen server answers every kind of request that needs one of its bundled packages."""
    with tempfile.TemporaryDirectory(prefix="mw backend check ") as data:
        process = subprocess.Popen(
            [str(server), "--port", "0"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=clean_environment({"MANUSCRIPT_WORKBENCH_DATA_DIR": data}), text=True,
        )
        try:
            ready = json.loads(process.stdout.readline())
            assert ready["event"] == "ready" and ready["version"] == APP_VERSION, ready
            url = ready["url"]
            assert json.load(request(url, "/api/health"))["version"] == APP_VERSION
            page = request(url, "/").read().decode()
            token = page.split('name="mw-token" content="')[1].split('"')[0]
            assert "/static/js/main.js" in page and request(url, "/static/js/main.js").status == 200
            html = json.load(request(url, "/api/render_markdown", {"text": "# Hi *there*"}, token))["html"]
            assert "<h1>Hi <em>there</em></h1>" in html, html
            docx = request(url, "/api/export_docx", {"text": "# C\n\n- one\n\n| a | b |\n|---|---|\n| 1 | 2 |", "metadata": {"title": "T"}}, token).read()
            assert docx[:2] == b"PK" and len(docx) > 20000
            epub = request(url, "/api/export_epub", {"text": "# C\n\ntext", "metadata": {"title": "T"}}, token)
            assert epub.headers["Content-Type"] == "application/epub+zip"
            body = {"filename": "a.html", "data_b64": base64.b64encode(ARTICLE.encode()).decode()}
            main = json.load(request(url, "/api/import_html_options", body, token))["main"]
            assert main["text"].startswith("# A title for the article") and not main["error"], main
            assert b"User Guide" in request(url, "/help").read()
            for name in ("settings", "preflight"):
                request(url, f"/api/{name}", {"text": "# One", "metadata": {}, "settings": {"wrap": True}}, token)
            assert (Path(data) / "manuscript_workbench_settings.json").exists(), "settings go to the data folder"
            process.stdin.write("stop\n")
            process.stdin.flush()
            assert process.wait(timeout=20) == 0
        finally:
            if process.poll() is None:
                process.kill()
    print(f"Verified the bundled server: {server}")


def alive(pid: int) -> bool:
    if sys.platform == "win32":  # os.kill(pid, 0) would terminate the process on Windows
        listing = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True)
        return str(pid) in listing.stdout
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def run_app(command: List[str], profile: Path, report: Path, layout: Optional[dict] = None) -> dict:
    env = clean_environment({
        "MANUSCRIPT_WORKBENCH_ELECTRON_PROFILE": str(profile),
        "MANUSCRIPT_WORKBENCH_SMOKE_REPORT": str(report),
    })
    if layout:
        env["MANUSCRIPT_WORKBENCH_SMOKE_LAYOUT"] = json.dumps(layout)
    if report.exists():
        report.unlink()
    arguments = list(command)
    if sys.platform.startswith("linux") and os.environ.get("CI"):
        arguments.append("--no-sandbox")  # hosted Linux runners do not allow Chromium's own sandbox helper
    subprocess.run(arguments, env=env, cwd=ROOT, timeout=180, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert report.exists(), "The app did not write its report (it did not start, or never loaded the page)."
    return json.loads(report.read_text(encoding="utf-8"))


def overlap(bounds: dict, area: dict) -> int:
    width = min(bounds["x"] + bounds["width"], area["x"] + area["width"]) - max(bounds["x"], area["x"])
    height = min(bounds["y"] + bounds["height"], area["y"] + area["height"]) - max(bounds["y"], area["y"])
    return max(0, width) * max(0, height)


def close(actual: dict, wanted: dict, tolerance: int = 3) -> bool:
    """The same place and size, give or take a few pixels (screen scaling rounds)."""
    return all(abs(actual[key] - wanted[key]) <= tolerance for key in wanted)


def on_a_screen(window: dict) -> bool:
    bounds = window["bounds"]
    return any(
        min(bounds["x"] + bounds["width"], area["x"] + area["width"]) - max(bounds["x"], area["x"]) >= 100
        and min(bounds["y"] + bounds["height"], area["y"] + area["height"]) - max(bounds["y"], area["y"]) >= 60
        for area in window["workAreas"]
    )


def check_window_state(command: List[str]) -> None:
    """The window comes back as it was left, and never off screen. Needs a window manager (not a bare Xvfb)."""
    with tempfile.TemporaryDirectory(prefix="mw window check ") as directory:
        root = Path(directory)
        profile, report = root / "profile", root / "report.json"
        state = profile / "window-state.json"
        first = run_app(command, profile, report)["window"]
        assert on_a_screen(first), first
        # A size that fits the screen it is tried on: a small virtual screen (as on a CI runner) clamps anything bigger.
        area = max(first["workAreas"], key=lambda a: overlap(first["bounds"], a))
        place = {
            "x": area["x"] + 10,
            "y": area["y"] + 10,
            "width": max(900, min(1111, area["width"] - 20)),
            "height": max(600, min(777, area["height"] - 20)),
        }
        run_app(command, profile, report, {"bounds": place})
        again = run_app(command, profile, report, {"maximize": True})["window"]
        assert close(again["normalBounds"], place), ("size and position are remembered", again, place)
        assert again["isMaximized"] is False
        maximized = run_app(command, profile, report)["window"]
        assert maximized["isMaximized"] is True, ("maximized is remembered", maximized)
        assert close(maximized["normalBounds"], place), ("the normal size is kept", maximized, place)
        # Unplugged screen: coordinates that are on no display must not leave the window out of reach.
        state.write_text(json.dumps({"x": 31000, "y": 29000, "width": 1200, "height": 800, "isMaximized": False}))
        lost = run_app(command, profile, report)["window"]
        assert on_a_screen(lost) and lost["bounds"]["x"] < 20000, ("off-screen window is brought back", lost)
        state.write_text("this is not json")
        damaged = run_app(command, profile, report)["window"]
        assert on_a_screen(damaged), damaged
    print("Verified remembering the window size and position.")


def check_app(command: List[str], window_state: bool = sys.platform != "linux") -> None:
    with tempfile.TemporaryDirectory(prefix="mw desktop check ") as directory:
        root = Path(directory)
        profile, report = root / "profile", root / "report.json"
        first = run_app(command, profile, report)
        assert first.get("ok"), first
        for key in ("editor", "token", "localStorage", "worker", "markdown", "docx", "epub", "trafilatura", "preflight", "guide"):
            assert first[key] is True, (key, first)
        assert first["nodeLeak"] is False and first["desktopBridge"]["desktop"] is True, first
        assert first["health"]["version"] == APP_VERSION and first["windowTitle"] == "Manuscript Workbench", first
        assert f"v{APP_VERSION}" in first["versionInHeader"], first
        deadline = time.time() + 20
        while alive(first["backendPid"]) and time.time() < deadline:
            time.sleep(0.2)
        assert not alive(first["backendPid"]), "The Python server is still running after the app quit."
        for name in ("window-state.json", "backend-port.json", "logs/backend.log"):
            assert (profile / name).exists(), f"{name} was not written"
        second = run_app(command, profile, report)
        assert second.get("ok") and second["origin"] == first["origin"], (first["origin"], second.get("origin"))
        assert second["returning"] is True, "Browser storage did not survive a restart."
        assert not alive(second["backendPid"]), "The Python server is still running after the second quit."
    print(f"Verified the desktop app: {' '.join(command)}")
    if window_state:
        check_window_state(command)


def main(argv: List[str]) -> int:
    if len(argv) >= 1 and argv[0] == "backend":
        check_backend(Path(argv[1]) if len(argv) > 1 else frozen_server())
    elif len(argv) >= 1 and argv[0] == "dev":
        check_app([str(ROOT / "electron" / "node_modules" / ".bin" / "electron"), str(ROOT / "electron")])
    elif len(argv) == 2 and argv[0] == "app":
        check_app([argv[1]])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
