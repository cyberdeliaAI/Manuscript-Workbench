"""The release tooling: environments for signing, the checks before a draft release, the release notes."""
from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import build_desktop  # noqa: E402
import release_assets  # noqa: E402

VERSION = "2.0.0"
SECRETS = {
    "CSC_LINK": "base64certificate", "CSC_KEY_PASSWORD": "secret", "APPLE_ID": "me@example.org",
    "APPLE_APP_SPECIFIC_PASSWORD": "abcd-efgh", "APPLE_TEAM_ID": "ABCDE12345",
}


# ---- build_desktop ---------------------------------------------------------------------------------------

def test_two_dot_zero_and_two_dot_zero_dot_zero_are_one_version():
    assert build_desktop.same_version("2.0", "2.0.0") and not build_desktop.same_version("2.0.1", "2.0")


def test_the_python_app_and_the_electron_package_have_the_same_version():
    package = json.loads((ROOT / "electron" / "package.json").read_text(encoding="utf-8"))
    assert build_desktop.same_version(package["version"], build_desktop.APP_VERSION)


@pytest.mark.parametrize("machine,expected", [("arm64", "arm64"), ("aarch64", "arm64"), ("x86_64", "x64"), ("AMD64", "x64")])
def test_target_names(monkeypatch, machine, expected):
    monkeypatch.setattr(build_desktop.platform, "machine", lambda: machine)
    monkeypatch.setattr(build_desktop.sys, "platform", "darwin")
    assert build_desktop.target_name() == f"macos-{expected}"
    monkeypatch.setattr(build_desktop.sys, "platform", "win32")
    assert build_desktop.target_name() == f"windows-{expected}"
    monkeypatch.setattr(build_desktop.sys, "platform", "linux")
    assert build_desktop.target_name() == f"linux-{expected}"


def test_signing_credentials_never_reach_an_ordinary_build():
    plain, packing = build_desktop.build_environments(False, {**SECRETS, "PATH": "/bin", "WIN_CSC_LINK": "x"})
    for env in (plain, packing):
        assert env["PATH"] == "/bin" and env["CSC_IDENTITY_AUTO_DISCOVERY"] == "false"
        assert not any(key.startswith(("CSC_LINK", "CSC_KEY", "APPLE_", "WIN_CSC")) for key in env)


def test_signing_gives_the_credentials_to_packing_only(monkeypatch):
    monkeypatch.setattr(build_desktop.sys, "platform", "darwin")
    plain, packing = build_desktop.build_environments(True, {**SECRETS, "PATH": "/bin"})
    assert not any(key in plain for key in SECRETS) and plain["CSC_IDENTITY_AUTO_DISCOVERY"] == "false"
    assert all(packing[key] == value for key, value in SECRETS.items()) and packing["CSC_IDENTITY_AUTO_DISCOVERY"] == "true"
    assert packing["CSC_FOR_PULL_REQUEST"] == "false"


@pytest.mark.parametrize("environ,message", [
    ({**SECRETS, "APPLE_ID": ""}, "Missing"),
    ({**SECRETS, "APPLE_TEAM_ID": "short"}, "ten-character"),
    ({**SECRETS, "GITHUB_EVENT_NAME": "pull_request"}, "release tags"),
    ({**SECRETS, "GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/heads/main"}, "release tags"),
])
def test_signing_is_refused_without_secrets_or_outside_a_release(monkeypatch, environ, message):
    monkeypatch.setattr(build_desktop.sys, "platform", "darwin")
    with pytest.raises(ValueError, match=message):
        build_desktop.build_environments(True, environ)


def test_signing_is_allowed_for_a_release_tag_and_a_manual_run(monkeypatch):
    monkeypatch.setattr(build_desktop.sys, "platform", "darwin")
    build_desktop.build_environments(True, {**SECRETS, "GITHUB_EVENT_NAME": "push", "GITHUB_REF": "refs/tags/v2.0.0"})
    build_desktop.build_environments(True, {**SECRETS, "GITHUB_EVENT_NAME": "workflow_dispatch"})


def test_signing_needs_macos(monkeypatch):
    monkeypatch.setattr(build_desktop.sys, "platform", "linux")
    with pytest.raises(ValueError, match="needs macOS"):
        build_desktop.build_environments(True, SECRETS)


def test_the_signed_configuration_fails_a_mac_build_without_a_certificate_but_not_the_other_platforms():
    result = subprocess.run(
        ["node", "-e", "const c = require('./tools/electron_signed.cjs'); console.log(JSON.stringify({mac: c.mac.forceCodeSigning, hardened: c.mac.hardenedRuntime, notarize: c.mac.notarize, identity: c.mac.identity, win: c.win.forceCodeSigning, linux: c.linux.forceCodeSigning, top: c.forceCodeSigning, appId: c.appId}))"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    assert json.loads(result.stdout) == {"mac": True, "hardened": True, "notarize": True, "appId": "nl.cyberdelia.manuscriptworkbench"}


# ---- release_assets ---------------------------------------------------------------------------------------

CHANGELOG = """# Changelog

## Unreleased

- something not released yet

## 2.0

### New

- the new things

## 1.2

old
"""


def test_release_notes_are_the_changelog_section_of_the_version():
    notes = release_assets.release_notes("2.0.0", CHANGELOG)
    assert notes.startswith("### New") and "the new things" in notes
    assert "something not released" not in notes and "old" not in notes
    assert release_assets.release_notes("2.0", CHANGELOG) == notes
    assert release_assets.release_notes("1.2.0", CHANGELOG) == "old\n"


def test_release_notes_for_an_unknown_version_are_an_error():
    with pytest.raises(ValueError, match="no section"):
        release_assets.release_notes("3.1.0", CHANGELOG)


def make_set(tmp_path, version=VERSION, signing=True):
    downloads, reports = tmp_path / "downloads", tmp_path / "reports"
    downloads.mkdir(parents=True)
    for target, suffix in release_assets.TARGETS.items():
        name = f"manuscript-workbench-{version}-{target}{suffix}"
        data = f"archive of {target}".encode()
        (downloads / name).write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        (downloads / (name + ".sha256")).write_text(f"{digest}  {name}\n", encoding="ascii")
        if target.startswith("macos-"):
            folder = reports / f"smoke-reports-{target}"
            folder.mkdir(parents=True)
            evidence = {key: signing for key in release_assets.SIGNING} | {"archive": name, "sha256": digest}
            (folder / "macos-signing.json").write_text(json.dumps(evidence))
    return downloads, reports


def test_a_complete_checked_set_is_accepted(tmp_path):
    downloads, reports = make_set(tmp_path)
    assets = release_assets.checked_assets(downloads, reports, VERSION)
    assert len(assets) == 8 and all(path.is_file() for path in assets)


def test_a_missing_or_extra_download_is_refused(tmp_path):
    downloads, reports = make_set(tmp_path)
    (downloads / f"manuscript-workbench-{VERSION}-linux-x64.tar.gz").unlink()
    with pytest.raises(ValueError, match="four-platform"):
        release_assets.checked_assets(downloads, reports, VERSION)
    downloads, reports = make_set(tmp_path / "again")
    (downloads / "surprise.txt").write_text("x")
    with pytest.raises(ValueError, match="four-platform"):
        release_assets.checked_assets(downloads, reports, VERSION)


def test_a_checksum_that_does_not_match_is_refused(tmp_path):
    downloads, reports = make_set(tmp_path)
    (downloads / f"manuscript-workbench-{VERSION}-windows-x64.zip").write_bytes(b"changed after the check")
    with pytest.raises(ValueError, match="checksum"):
        release_assets.checked_assets(downloads, reports, VERSION)


def test_unsigned_or_mismatched_macos_evidence_is_refused(tmp_path):
    downloads, reports = make_set(tmp_path, signing=False)
    with pytest.raises(ValueError, match="signing evidence"):
        release_assets.checked_assets(downloads, reports, VERSION)
    downloads, reports = make_set(tmp_path / "second")
    path = reports / "smoke-reports-macos-x64" / "macos-signing.json"
    data = json.loads(path.read_text())
    data["sha256"] = "0" * 64
    path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="signing evidence"):
        release_assets.checked_assets(downloads, reports, VERSION)


class FakeGh:
    """Stands in for the gh command: records what would be sent to GitHub."""

    def __init__(self, release=None):
        self.release, self.calls = release, []

    def view(self, *args):
        if self.release is None:
            raise subprocess.CalledProcessError(1, "gh")
        return self.release

    def run(self, command, check=True):
        self.calls.append(command[1:3])
        if command[1:3] == ["release", "create"]:
            self.release = {"isDraft": True, "targetCommitish": "main", "assets": []}
        if command[1:3] == ["release", "upload"]:
            self.release = {**self.release, "assets": [{"name": pathlib.Path(p).name, "size": pathlib.Path(p).stat().st_size} for p in command[4:]]}


def install(monkeypatch, gh, version=VERSION):
    monkeypatch.setattr(release_assets, "gh", gh.view)
    monkeypatch.setattr(release_assets.subprocess, "run", gh.run)
    monkeypatch.setattr(release_assets, "package_version", lambda: version)


def test_the_release_is_created_as_a_draft_with_all_assets(tmp_path, monkeypatch):
    downloads, reports = make_set(tmp_path)
    gh = FakeGh()
    install(monkeypatch, gh)
    release_assets.publish_draft(f"v{VERSION}", "a" * 40, downloads, reports)
    assert gh.calls == [["release", "create"], ["release", "upload"]]
    assert gh.release["isDraft"] is True and len(gh.release["assets"]) == 8
    assert not any(call == ["release", "edit"] for call in gh.calls), "it is never published by the workflow"


def test_nothing_is_changed_for_a_wrong_tag_a_published_release_or_a_draft_with_assets(tmp_path, monkeypatch):
    downloads, reports = make_set(tmp_path)
    install(monkeypatch, FakeGh())
    with pytest.raises(ValueError, match="tag must be"):
        release_assets.publish_draft("v9.9.9", "a" * 40, downloads, reports)
    published = FakeGh({"isDraft": False, "targetCommitish": "main", "assets": []})
    install(monkeypatch, published)
    with pytest.raises(ValueError, match="already published"):
        release_assets.publish_draft(f"v{VERSION}", "a" * 40, downloads, reports)
    busy = FakeGh({"isDraft": True, "targetCommitish": "main", "assets": [{"name": "x", "size": 1}]})
    install(monkeypatch, busy)
    with pytest.raises(ValueError, match="already has assets"):
        release_assets.publish_draft(f"v{VERSION}", "a" * 40, downloads, reports)
    assert published.calls == [] and busy.calls == []


# ---- the workflow ------------------------------------------------------------------------------------------

def test_the_workflow_is_a_release_by_tag_with_a_draft_and_the_four_platforms():
    text = (ROOT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    for needle in ('tags: ["v*"]', "workflow_dispatch:", "contents: write", "macos-latest", "macos-15-intel", "windows-latest",
                   "ubuntu-latest", "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}", "python tools/build_desktop.py --sign-macos",
                   "tools/release_assets.py"):
        assert needle in text, needle
    for secret in SECRETS:
        assert f"secrets.{secret}" in text
    assert "--draft=false" not in text and "gh release edit" not in text
