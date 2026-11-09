"""Build the desktop app: the Python server frozen with PyInstaller, inside an Electron app made by electron-builder.

  python tools/build_desktop.py                  an archive in electron/out (zip on macOS and Windows, tar.gz on Linux)
  python tools/build_desktop.py --dir            only the unpacked app, for trying it locally
  python tools/build_desktop.py --skip-install   reuse electron/node_modules and the PyInstaller build

A frozen server only runs on the system it was built on, so every platform builds on its own (see
.github/workflows/desktop.yml). Needs Node.js with npm, and `pip install -r requirements-build.txt`.
After building, the app is started once with disposable settings and checked (tools/check_desktop.py).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from check_desktop import APP_VERSION, ROOT, check_app, check_backend, clean_environment, frozen_server

ELECTRON = ROOT / "electron"
MAC_SIGNING_SECRETS = ("CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID")


def same_version(a: str, b: str) -> bool:
    pad = lambda value: (value.split(".") + ["0", "0", "0"])[:3]  # noqa: E731 - 2.0 and 2.0.0 are one version
    return pad(a) == pad(b)


def build_environments(sign_macos: bool):
    """Signing credentials stay out of installing, freezing and every ordinary build."""
    plain = {key: value for key, value in os.environ.items() if not key.startswith(("CSC_", "WIN_CSC_", "APPLE_"))}
    plain["CSC_IDENTITY_AUTO_DISCOVERY"] = "false"
    if not sign_macos:
        return plain, plain
    if sys.platform != "darwin":
        raise ValueError("--sign-macos needs macOS")
    missing = [key for key in MAC_SIGNING_SECRETS if not os.environ.get(key)]
    if missing:
        raise ValueError("Missing macOS signing secrets: " + ", ".join(missing))
    signed = dict(plain, **{key: os.environ[key] for key in MAC_SIGNING_SECRETS})
    signed["CSC_IDENTITY_AUTO_DISCOVERY"] = "true"
    return plain, signed


def unpacked_app() -> list:
    """The command that starts the unpacked app electron-builder left in electron/out."""
    out = ELECTRON / "out"
    if sys.platform == "darwin":
        app = next(out.glob("mac*/Manuscript Workbench.app"))
        return [str(app / "Contents" / "MacOS" / "Manuscript Workbench")]
    if sys.platform == "win32":
        return [str(out / "win-unpacked" / "Manuscript Workbench.exe")]
    return [str(out / "linux-unpacked" / "manuscript-workbench")]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", action="store_true", help="build the unpacked app only")
    parser.add_argument("--skip-install", action="store_true", help="reuse electron/node_modules")
    parser.add_argument("--skip-backend", action="store_true", help="reuse the PyInstaller build in build/desktop")
    parser.add_argument("--sign-macos", action="store_true", help="Developer ID signing and notarization (macOS)")
    args = parser.parse_args()
    try:
        plain, packing = build_environments(args.sign_macos)
    except ValueError as error:
        parser.error(str(error))
    package = json.loads((ELECTRON / "package.json").read_text(encoding="utf-8"))
    if not same_version(package["version"], APP_VERSION):
        parser.error(f"electron/package.json is {package['version']}, the Python app {APP_VERSION}: make them match")
    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    node = shutil.which("node")
    if not npm or not node:
        parser.error("Install Node.js (with npm) to build the desktop app")

    if not args.skip_backend:
        subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
                        "--distpath", str(ROOT / "build" / "desktop" / "backend"),
                        "--workpath", str(ROOT / "build" / "desktop" / "pyinstaller"),
                        str(ELECTRON / "backend.spec")], check=True, cwd=ROOT, env=plain)
    check_backend(frozen_server())
    if not args.skip_install:
        subprocess.run([npm, "ci"], check=True, cwd=ELECTRON, env=plain)
    # Since Electron 42 the binary is downloaded by this explicit step, not by npm's postinstall.
    subprocess.run([node, "node_modules/electron/install.js"], check=True, cwd=ELECTRON, env=plain)
    shutil.rmtree(ELECTRON / "out", ignore_errors=True)
    command = [npm, "run", "pack" if args.dir else "dist"]
    if args.sign_macos:
        command += ["--", "--config", str(ROOT / "tools" / "electron_signed.cjs")]
    subprocess.run(command, check=True, cwd=ELECTRON, env=packing)
    check_app(unpacked_app())
    if not args.dir:
        for archive in sorted((ELECTRON / "out").glob("manuscript-workbench-desktop-*")):
            if archive.suffix in {".zip", ".gz"}:
                digest = hashlib.sha256(archive.read_bytes()).hexdigest()
                archive.with_name(archive.name + ".sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
                print(f"{archive.name}  {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
