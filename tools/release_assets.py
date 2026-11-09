"""Create the draft GitHub release for a tag from the checked downloads of all four platforms.

  python tools/release_assets.py --tag v2.0.0 --commit <sha>   (run by .github/workflows/release.yml, needs GH_TOKEN)

The release stays a draft: it is published by hand. Nothing is uploaded unless every download is there, every checksum
matches, and the two macOS downloads come with evidence that they are Developer ID signed and notarized.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {"macos-arm64": ".zip", "macos-x64": ".zip", "windows-x64": ".zip", "linux-x64": ".tar.gz"}
SIGNING = ("developer_id", "hardened_runtime", "notarization_ticket", "gatekeeper")


def package_version() -> str:
    return json.loads((ROOT / "electron" / "package.json").read_text(encoding="utf-8"))["version"]


def release_notes(version: str, changelog: str) -> str:
    """The CHANGELOG section of this version ("## 2.0" serves 2.0.0), without its heading."""
    wanted = {version, re.sub(r"\.0$", "", version)}
    sections = re.split(r"(?m)^## ", changelog)[1:]
    for section in sections:
        heading, _, body = section.partition("\n")
        if heading.strip() in wanted and body.strip():
            return body.strip() + "\n"
    raise ValueError(f"CHANGELOG.md has no section for version {version}.")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def checked_assets(downloads: Path, reports: Path, version: str) -> List[Path]:
    """The archives and checksum files of all four platforms, after checking them."""
    expected = {f"manuscript-workbench-{version}-{target}{suffix}" for target, suffix in TARGETS.items()}
    expected |= {name + ".sha256" for name in tuple(expected)}
    paths = {path.name: path for path in downloads.iterdir()}
    if set(paths) != expected:
        raise ValueError("The complete four-platform set of downloads and checksums is required.")
    for name, path in paths.items():
        if path.is_symlink() or not path.is_file() or not path.stat().st_size:
            raise ValueError("Release assets must be nonempty regular files.")
        if name.endswith(".sha256"):
            continue
        digest = sha256(path)
        if paths[name + ".sha256"].read_text("ascii").strip() != f"{digest}  {name}":
            raise ValueError("A release checksum does not match its archive.")
        for target in ("macos-arm64", "macos-x64"):
            if name == f"manuscript-workbench-{version}-{target}.zip":
                data = json.loads((reports / f"smoke-reports-{target}" / "macos-signing.json").read_text(encoding="utf-8"))
                if any(data.get(key) is not True for key in SIGNING) or data.get("archive") != name or data.get("sha256") != digest:
                    raise ValueError("macOS signing evidence is missing or does not match the archive.")
    return [paths[name] for name in sorted(paths)]


def gh(*args: str) -> object:
    return json.loads(subprocess.check_output(["gh", *args], text=True))


def publish_draft(tag: str, commit: str, downloads: Path, reports: Path) -> None:
    version = package_version()
    if tag != f"v{version}":
        raise ValueError(f"The tag must be v{version} to match electron/package.json.")
    assets = checked_assets(downloads, reports, version)
    notes = release_notes(version, (ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))
    fields = "isDraft,targetCommitish,assets"
    try:
        release = gh("release", "view", tag, "--json", fields)
    except subprocess.CalledProcessError:
        release = None
    if release is None:
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8") as handle:
            handle.write(notes)
        subprocess.run(["gh", "release", "create", tag, "--draft", "--verify-tag", "--title", f"Manuscript Workbench {version}",
                        "--notes-file", handle.name], check=True)
        release = gh("release", "view", tag, "--json", fields)
    if not release["isDraft"]:
        raise ValueError("This release is already published; nothing is changed.")
    if release["assets"]:
        raise ValueError("The draft already has assets; review it by hand before replacing anything.")
    subprocess.run(["gh", "release", "upload", tag, *(str(path) for path in assets)], check=True)
    uploaded = gh("release", "view", tag, "--json", fields)
    if {item["name"]: item["size"] for item in uploaded["assets"]} != {path.name: path.stat().st_size for path in assets}:
        raise ValueError("The uploaded assets do not match the downloads; the draft stays unpublished.")
    print(f"Draft release {tag} for {commit[:7]} has {len(assets)} files. Review and publish it by hand.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--downloads", type=Path, default=Path("downloads"))
    parser.add_argument("--reports", type=Path, default=Path("reports"))
    args = parser.parse_args()
    publish_draft(args.tag, args.commit, args.downloads, args.reports)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
