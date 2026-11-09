"""Build the desktop app: the Python server frozen with PyInstaller, inside an Electron app made by electron-builder.

  python tools/build_desktop.py                  an archive in dist/packages (zip on macOS and Windows, tar.gz on Linux)
  python tools/build_desktop.py --dir            only the unpacked app (electron/out), for trying it locally
  python tools/build_desktop.py --skip-install   reuse electron/node_modules and the PyInstaller build
  python tools/build_desktop.py --sign-macos     Developer ID signing and notarization (macOS, needs the Apple secrets)

A frozen server only runs on the system it was built on, so every platform builds on its own (see
.github/workflows/release.yml). Needs Node.js with npm, and `pip install -r requirements-build.txt`.
The finished archive is unpacked into a temporary folder and that copy is started and checked
(tools/check_desktop.py), so what is checked is what gets released.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, Optional, Tuple

from check_desktop import APP_VERSION, ROOT, check_app, check_backend, frozen_server

ELECTRON = ROOT / "electron"
PRODUCT = "Manuscript Workbench"
MAC_SIGNING_SECRETS = ("CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID")


def same_version(a: str, b: str) -> bool:
    pad = lambda value: (value.split(".") + ["0", "0", "0"])[:3]  # noqa: E731 - 2.0 and 2.0.0 are one version
    return pad(a) == pad(b)


def target_name() -> str:
    """macos-arm64, macos-x64, windows-x64 or linux-x64: the name of this build in file names and in the workflow."""
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
    system = {"darwin": "macos", "win32": "windows"}.get(sys.platform, "linux")
    return f"{system}-{arch}"


def build_environments(sign_macos: bool, environ: Optional[Dict[str, str]] = None) -> Tuple[dict, dict]:
    """Signing credentials stay out of installing, freezing and every ordinary build; only packing sees them."""
    environ = dict(os.environ if environ is None else environ)
    plain = {key: value for key, value in environ.items() if not key.startswith(("CSC_", "WIN_CSC_", "APPLE_"))}
    plain["CSC_IDENTITY_AUTO_DISCOVERY"] = "false"
    plain["CSC_FOR_PULL_REQUEST"] = "false"
    if not sign_macos:
        return plain, dict(plain)
    if sys.platform != "darwin":
        raise ValueError("--sign-macos needs macOS")
    event = environ.get("GITHUB_EVENT_NAME", "")
    if event and not (event == "workflow_dispatch" or (event == "push" and environ.get("GITHUB_REF", "").startswith("refs/tags/v"))):
        raise ValueError("Developer ID signing is only for release tags and builds started by hand")
    missing = [key for key in MAC_SIGNING_SECRETS if not environ.get(key)]
    if missing:
        raise ValueError("Missing macOS signing secrets: " + ", ".join(missing))
    if not re.fullmatch(r"[A-Z0-9]{10}", environ["APPLE_TEAM_ID"]):
        raise ValueError("APPLE_TEAM_ID must be a ten-character Apple team identifier")
    signed = dict(plain, **{key: environ[key] for key in MAC_SIGNING_SECRETS})
    signed["CSC_IDENTITY_AUTO_DISCOVERY"] = "true"
    signed["CSC_FOR_PULL_REQUEST"] = "false"
    return plain, signed


def unpacked_app() -> Path:
    out = ELECTRON / "out"
    if sys.platform == "darwin":
        return next(out.glob(f"mac*/{PRODUCT}.app"))
    return out / ("win-unpacked" if sys.platform == "win32" else "linux-unpacked")


def executable(directory: Path) -> Path:
    if sys.platform == "darwin":
        return directory / "Contents" / "MacOS" / PRODUCT
    return directory / (f"{PRODUCT}.exe" if sys.platform == "win32" else "manuscript-workbench")


def verify_macos_app(directory: Path, team_id: Optional[str] = None) -> None:
    """The app (and the frozen server inside it) is signed; with a team: Developer ID, hardened, notarized, stapled."""
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(directory)], check=True)
    if team_id is None:
        return
    server = directory / "Contents" / "Resources" / "backend" / "manuscript-workbench-server"
    for signed in (directory, server):
        if signed != directory:
            subprocess.run(["codesign", "--verify", "--strict", str(signed)], check=True)
        details = subprocess.run(["codesign", "--display", "--verbose=4", str(signed)], check=True, capture_output=True, text=True)
        signature = details.stdout + details.stderr
        if (
            "Authority=Developer ID Application:" not in signature
            or f"TeamIdentifier={team_id}\n" not in signature
            or not re.search(r"^CodeDirectory .*flags=.*\bruntime\b", signature, re.MULTILINE)
        ):
            raise RuntimeError("The app and its server need hardened Developer ID signatures from APPLE_TEAM_ID")
    subprocess.run(["xcrun", "stapler", "validate", str(directory)], check=True)
    subprocess.run(["spctl", "--assess", "--type", "execute", "--verbose=2", str(directory)], check=True)
    reports = ROOT / "build" / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "macos-signing.json").write_text(
        json.dumps({"developer_id": True, "hardened_runtime": True, "notarization_ticket": True, "gatekeeper": True}, indent=2) + "\n",
        encoding="utf-8",
    )


def archive_app(directory: Path, version: str, team_id: Optional[str] = None) -> Path:
    """Packs the app, unpacks the archive again and checks that copy, then writes its checksum."""
    packages = ROOT / "dist" / "packages"
    packages.mkdir(parents=True, exist_ok=True)
    stem = f"manuscript-workbench-{version}-{target_name()}"
    if sys.platform == "darwin":
        archive = packages / (stem + ".zip")
        archive.unlink(missing_ok=True)
        subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(directory), str(archive)], check=True)
    elif sys.platform == "win32":
        archive = Path(shutil.make_archive(str(packages / stem), "zip", directory))
    else:
        archive = packages / (stem + ".tar.gz")
        with tarfile.open(archive, "w:gz") as packed:
            packed.add(directory, arcname=PRODUCT)
    with tempfile.TemporaryDirectory(prefix="mw desktop extracted ") as name:
        extracted = Path(name)
        if sys.platform == "darwin":
            subprocess.run(["ditto", "-x", "-k", str(archive), str(extracted)], check=True)
            directory = extracted / directory.name
            verify_macos_app(directory, team_id)
        elif sys.platform == "win32":
            with zipfile.ZipFile(archive) as packed:
                packed.extractall(extracted)
            directory = extracted
        else:
            with tarfile.open(archive) as packed:
                packed.extractall(extracted, filter="data")
            directory = extracted / PRODUCT
        check_app([str(executable(directory))])
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_name(archive.name + ".sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    if team_id:
        report = ROOT / "build" / "reports" / "macos-signing.json"
        report.write_text(
            json.dumps({**json.loads(report.read_text(encoding="utf-8")), "archive": archive.name, "sha256": digest}, indent=2) + "\n",
            encoding="utf-8",
        )
    print(f"Verified {archive.name}: {digest}")
    return archive


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
    command = [npm, "run", "pack"]
    if args.sign_macos:
        command += ["--", "--config", str(ROOT / "tools" / "electron_signed.cjs")]
    subprocess.run(command, check=True, cwd=ELECTRON, env=packing)
    directory = unpacked_app()
    team_id = packing["APPLE_TEAM_ID"] if args.sign_macos else None
    if args.dir:
        if sys.platform == "darwin":
            verify_macos_app(directory, team_id)
        check_app([str(executable(directory))])
        print(f"Verified app: {directory}")
    else:
        archive_app(directory, package["version"], team_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
