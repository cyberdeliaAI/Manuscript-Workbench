"""The server for the Electron desktop app: pick a port, say when it is ready, stop when asked.

Electron starts this as a child process and speaks a tiny protocol over its pipes:

  stdout  one JSON line {"event": "ready", "protocol": 1, "version": ..., "url": "http://127.0.0.1:PORT"}
          or {"event": "error", "message": ...} when the server cannot start
  stdin   the line "stop" (or the end of the pipe, when Electron is gone) ends the server

Run by hand with: python -m manuscript_workbench.desktop_host [--port N]   (port 0 picks a free one)
"""
from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
from typing import Optional, Sequence

from .config import APP_HOST, APP_VERSION
from .server import ManuscriptWorkbenchHandler, ReusableThreadingHTTPServer, missing_dependencies
from .settings import scrub_stored_secrets

PROTOCOL = 1


class DesktopServer(ReusableThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets a second process bind a port that is in use; the desktop app must not do that.
    allow_reuse_address = sys.platform != "win32"
    daemon_threads = False  # requests that are being handled (a project save) finish before the server exits


def report(**event: object) -> None:
    print(json.dumps(event), flush=True)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=0, help="port on 127.0.0.1 (default 0: a free one)")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("Choose a port between 0 and 65535.")
    missing = missing_dependencies()
    if missing:
        report(event="error", code="dependencies", message="Missing Python packages: " + ", ".join(missing))
        return 2
    scrub_stored_secrets()
    try:
        server = DesktopServer((APP_HOST, args.port), ManuscriptWorkbenchHandler)
    except OSError as exc:
        report(event="error", code="port", message=f"The port {args.port} is not available: {exc}")
        return 1

    stopping = threading.Event()

    def watch_parent() -> None:
        try:
            for line in sys.stdin:
                if line.strip() == "stop":
                    break
        finally:
            stopping.set()  # the end of stdin also stops us, so a crashed Electron does not leave a server behind

    for name in ("SIGTERM", "SIGINT"):
        signal.signal(getattr(signal, name), lambda _signum, _frame: stopping.set())
    threading.Thread(target=watch_parent, daemon=True).start()
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    report(event="ready", protocol=PROTOCOL, version=APP_VERSION, url=f"http://{APP_HOST}:{server.server_address[1]}")
    try:
        stopping.wait()
    finally:
        server.shutdown()
        server.server_close()  # waits for requests that are still being handled
        worker.join()
    return 0


if __name__ == "__main__":
    sys.exit(main())
