"""Project files and snapshots: safe ids, atomic writes, conflicts, retention, trash and the HTTP endpoints."""
from __future__ import annotations

import json
import os

import pytest


def err(mw, fn, *args, **kwargs):
    with pytest.raises(mw.HttpError) as info:
        fn(*args, **kwargs)
    return info.value


FULL = {
    "text": "# Chapter\n\nCafé — “quoted”.\n",
    "metadata": {"title": "My Book", "author": "A. Writer", "language": "nl"},
    "glossary": "Marta => Marta",
    "ignoredCandidates": ["colofon"],
    "customPrompts": [{"name": "Mine", "text": "Rewrite gently."}],
    "settings": {"lmProvider": "omlx", "lmBase": "http://localhost:8000/v1", "chunkSize": "4000"},
}


# ---------- ids and names ----------

def test_project_ids_come_from_names(mw):
    assert mw.project_id_for_name("My Book: Part 1!") == "My-Book-Part-1"
    assert mw.project_id_for_name("  trailing...  ") == "trailing"
    assert mw.project_id_for_name("../../etc/passwd") == "etc-passwd"
    assert len(mw.project_id_for_name("x" * 300)) == 80
    for bad in ["", "   ", "...", "///", None]:
        assert err(mw, mw.project_id_for_name, bad).status == 400


@pytest.mark.parametrize("pid", ["../x", "a/b", "a\\b", ".hidden", "", "a b", "x" * 81, "nul\x00", ".trash", "..", 5, None])
def test_check_id_refuses_anything_that_could_leave_the_folder(mw, pid):
    assert err(mw, mw.check_id, pid).status == 400


# ---------- save, open, list ----------

def test_save_and_open_round_trip(mw, projects):
    saved = mw.save_project("My Book", FULL, create_only=True)
    assert saved["id"] == "My-Book" and saved["name"] == "My Book" and saved["words"] > 0
    opened = mw.read_project("My-Book")
    for key in ("text", "metadata", "glossary", "ignoredCandidates", "customPrompts", "settings"):
        assert opened[key] == FULL[key], key
    raw = json.loads((projects / "My-Book.mwb.json").read_text(encoding="utf-8"))
    assert raw["format"] == "manuscript-workbench-project" and raw["version"] == 1
    assert "é" in (projects / "My-Book.mwb.json").read_text(encoding="utf-8"), "stored as readable UTF-8, not escapes"


def test_normalize_drops_unknown_fields_and_secrets(mw, projects):
    dirty = {"text": "t", "metadata": {"title": "T", "evil": "x", "author": 5}, "settings": {"lmApiKey": "KEY", "lmBase": "u", "wrap": True, "chunkSize": {"nested": 1}},
             "customPrompts": [{"name": "ok", "text": "x"}, {"name": "", "text": "y"}, {"name": 3, "text": "z"}, "junk"], "ignoredCandidates": ["a", 5, None], "extra": 1}
    mw.save_project("Dirty", dirty, create_only=True)
    opened = mw.read_project("Dirty")
    assert opened["metadata"] == {"title": "T", "author": "5"}
    assert opened["settings"] == {"lmBase": "u"}
    assert opened["customPrompts"] == [{"name": "ok", "text": "x"}]
    assert opened["ignoredCandidates"] == ["a"]
    assert "KEY" not in (projects / "Dirty.mwb.json").read_text(encoding="utf-8")


def test_invalid_content_is_refused(mw, projects):
    assert err(mw, mw.save_project, "X", "not an object", create_only=True).status == 400
    assert err(mw, mw.save_project, "X", {"text": 5}, create_only=True).status == 400
    assert err(mw, mw.save_project, "", {"text": ""}, create_only=True).status == 400
    assert not projects.exists() or not list(projects.iterdir())


def test_a_new_project_never_overwrites_an_existing_one(mw, projects):
    mw.save_project("Book", {"text": "one"}, create_only=True)
    assert err(mw, mw.save_project, "Book", {"text": "two"}, create_only=True).code == "exists"
    assert mw.read_project("Book")["text"] == "one"


def test_updates_need_the_current_updated_at_unless_forced(mw, projects):
    first = mw.save_project("Book", {"text": "one"}, create_only=True)
    assert err(mw, mw.save_project, "Book", {"text": "x"}, project_id="Book").code == "conflict"  # no base given
    assert err(mw, mw.save_project, "Book", {"text": "x"}, project_id="Book", base_updated_at="1999-01-01").code == "conflict"
    second = mw.save_project("Book", {"text": "two"}, project_id="Book", base_updated_at=first["updatedAt"])
    assert second["createdAt"] == first["createdAt"], "createdAt survives updates"
    assert second["updatedAt"] >= first["updatedAt"]
    mw.save_project("Book", {"text": "three"}, project_id="Book", force=True)
    assert mw.read_project("Book")["text"] == "three"


def test_the_previous_version_is_kept_as_bak_and_no_temp_files_remain(mw, projects):
    first = mw.save_project("Book", {"text": "one"}, create_only=True)
    mw.save_project("Book", {"text": "two"}, project_id="Book", base_updated_at=first["updatedAt"])
    bak = json.loads((projects / "Book.mwb.json.bak").read_text(encoding="utf-8"))
    assert bak["text"] == "one"
    assert not [p for p in projects.iterdir() if p.name.endswith(".tmp")]


def test_a_failed_write_leaves_the_original_untouched(mw, projects, monkeypatch):
    first = mw.save_project("Book", {"text": "precious"}, create_only=True)

    def boom(src, dst):
        raise OSError("disk full")

    with monkeypatch.context() as patched:
        patched.setattr(os, "replace", boom)
        with pytest.raises(OSError):
            mw.save_project("Book", {"text": "new"}, project_id="Book", base_updated_at=first["updatedAt"])
    assert mw.read_project("Book")["text"] == "precious"
    assert not [p for p in projects.iterdir() if p.name.endswith(".tmp")]


def test_list_is_sorted_and_skips_damaged_files(mw, projects):
    mw.save_project("Old", {"text": "a b c"}, create_only=True)
    mw.save_project("New", {"text": "d e"}, create_only=True)
    (projects / "Broken.mwb.json").write_text("{not json", encoding="utf-8")
    (projects / "Foreign.mwb.json").write_text(json.dumps({"format": "something-else"}), encoding="utf-8")
    (projects / "bad name.mwb.json").write_text("{}", encoding="utf-8")
    listing = mw.list_projects()
    assert [p["id"] for p in listing] == ["New", "Old"]
    assert listing[1]["words"] == 3 and listing[0]["snapshots"] == 0


def test_a_project_from_a_newer_version_is_not_opened(mw, projects):
    projects.mkdir(parents=True)
    (projects / "Future.mwb.json").write_text(json.dumps({"format": "manuscript-workbench-project", "version": 99, "text": "x"}), encoding="utf-8")
    assert err(mw, mw.read_project, "Future").code == "newer-version"
    assert err(mw, mw.read_project, "Missing").status == 404


def test_delete_moves_everything_to_the_trash(mw, projects):
    mw.save_project("Book", {"text": "one"}, create_only=True)
    mw.create_snapshot("Book", "one", kind="manual", label="first")
    mw.delete_project("Book")
    assert mw.list_projects() == []
    trashed = list((projects / ".trash").iterdir())
    assert len(trashed) == 1 and trashed[0].name.startswith("Book-")
    assert (trashed[0] / "Book.mwb.json").is_file() and (trashed[0] / "Book.snapshots").is_dir()
    assert err(mw, mw.delete_project, "Book").status == 404


# ---------- snapshots ----------

def test_snapshots_create_list_get(mw, projects):
    mw.save_project("Book", {"text": "v1"}, create_only=True)
    a = mw.create_snapshot("Book", "version one", kind="manual", label="Before editing")
    b = mw.create_snapshot("Book", "version two", kind="auto", reason="Before AI rewrite")
    assert a["kind"] == "manual" and a["label"] == "Before editing" and a["words"] == 2
    listing = mw.list_snapshots("Book")
    assert [s["id"] for s in listing] == [b["id"], a["id"]], "newest first"
    assert "text" not in listing[0]
    got = mw.get_snapshot("Book", a["id"])
    assert got["text"] == "version one" and got["sha256"] == a["sha256"]
    assert mw.list_projects()[0]["snapshots"] == 2


def test_automatic_snapshots_are_not_repeated_but_manual_ones_are(mw, projects):
    mw.save_project("Book", {"text": "x"}, create_only=True)
    first = mw.create_snapshot("Book", "same text", kind="auto", reason="r")
    again = mw.create_snapshot("Book", "same text", kind="auto", reason="r2")
    assert again["id"] == first["id"] and again["duplicate"] is True
    manual = mw.create_snapshot("Book", "same text", kind="manual", label="keep")
    assert manual["id"] != first["id"]
    assert len(mw.list_snapshots("Book")) == 2


def test_only_the_newest_fifty_automatic_snapshots_are_kept(mw, projects):
    mw.save_project("Book", {"text": "x"}, create_only=True)
    manual_ids = [mw.create_snapshot("Book", f"manual {i}", kind="manual", label=f"m{i}")["id"] for i in range(3)]
    for i in range(55):
        mw.create_snapshot("Book", f"auto {i}", kind="auto", reason="r")
    snaps = mw.list_snapshots("Book")
    autos = [s for s in snaps if s["kind"] == "auto"]
    assert len(autos) == 50 and all(m in [s["id"] for s in snaps] for m in manual_ids)
    assert mw.get_snapshot("Book", autos[0]["id"])["text"] == "auto 54", "the newest survives"
    assert "auto 4" not in [mw.get_snapshot("Book", s["id"])["text"] for s in autos], "the oldest were pruned"
    folder = projects / "Book.snapshots"
    assert len(list(folder.glob("*.txt"))) == len(list(folder.glob("*.meta.json"))), "no orphaned files"


def test_restore_returns_the_text_and_backs_up_what_it_replaces(mw, projects):
    mw.save_project("Book", {"text": "x"}, create_only=True)
    old = mw.create_snapshot("Book", "the old text", kind="manual", label="Draft 1")
    result = mw.restore_snapshot("Book", old["id"], "my current text")
    assert result["text"] == "the old text" and "text" not in result["snapshot"]
    assert result["backup"]["kind"] == "auto" and "Draft 1" in result["backup"]["reason"]
    assert mw.get_snapshot("Book", result["backup"]["id"])["text"] == "my current text"
    assert mw.restore_snapshot("Book", old["id"])["backup"] is None


def test_delete_snapshot_and_error_cases(mw, projects):
    mw.save_project("Book", {"text": "x"}, create_only=True)
    snap = mw.create_snapshot("Book", "t", kind="manual")
    mw.delete_snapshot("Book", snap["id"])
    assert mw.list_snapshots("Book") == []
    assert err(mw, mw.delete_snapshot, "Book", snap["id"]).status == 404
    for bad in ["../x", "20260101", "20260101T000000000000Z-other", "", None, "a/../b"]:
        assert err(mw, mw.get_snapshot, "Book", bad).status == 400, bad
    assert err(mw, mw.create_snapshot, "Missing", "t").status == 404
    assert err(mw, mw.create_snapshot, "Book", 5).status == 400
    assert err(mw, mw.create_snapshot, "Book", "t", kind="weird").status == 400


def test_periodic_snapshot_only_when_the_text_changed_and_the_last_one_is_old(mw, projects, monkeypatch):
    first = mw.save_project("Book", {"text": "one"}, create_only=True, periodic_snapshot=True)
    assert mw.list_snapshots("Book") == [], "creating a project does not snapshot"
    second = mw.save_project("Book", {"text": "two"}, project_id="Book", base_updated_at=first["updatedAt"], periodic_snapshot=True)
    assert [s["reason"] for s in mw.list_snapshots("Book")] == ["Periodic"]
    third = mw.save_project("Book", {"text": "three"}, project_id="Book", base_updated_at=second["updatedAt"], periodic_snapshot=True)
    assert len(mw.list_snapshots("Book")) == 1, "the last snapshot is younger than the interval"
    monkeypatch.setattr(mw, "PERIODIC_SNAPSHOT_MINUTES", 0)
    mw.save_project("Book", {"text": "three"}, project_id="Book", base_updated_at=third["updatedAt"], periodic_snapshot=True)
    assert len(mw.list_snapshots("Book")) == 1, "unchanged text is not snapshotted"
    mw.save_project("Book", {"text": "four"}, project_id="Book", force=True, periodic_snapshot=True)
    assert len(mw.list_snapshots("Book")) == 2


# ---------- HTTP ----------

def post(server, action, body=None, **kw):
    status, _h, data = server.request("POST", f"/api/projects/{action}", body=body or {}, **kw)
    return status, json.loads(data)


def test_http_project_flow(server):
    assert post(server, "list") == (200, {"projects": [], "dir": str(server.projects_dir)})
    status, body = post(server, "save", {"name": "My Book", "createOnly": True, "project": FULL})
    assert status == 200 and body["saved"]["id"] == "My-Book"
    status, body = post(server, "open", {"id": "My-Book"})
    assert status == 200 and body["project"]["metadata"]["title"] == "My Book" and body["project"]["text"] == FULL["text"]
    status, body = post(server, "save", {"name": "My Book", "createOnly": True, "project": FULL})
    assert status == 409 and body["code"] == "exists"
    updated = post(server, "list")[1]["projects"][0]["updatedAt"]
    status, body = post(server, "save", {"id": "My-Book", "name": "My Book", "project": {"text": "new"}, "baseUpdatedAt": "stale"})
    assert status == 409 and body["code"] == "conflict"
    status, body = post(server, "save", {"id": "My-Book", "name": "My Book", "project": {"text": "new"}, "baseUpdatedAt": updated})
    assert status == 200
    assert post(server, "delete", {"id": "My-Book"}) == (200, {"ok": True})
    assert post(server, "open", {"id": "My-Book"})[0] == 404


def test_http_snapshot_flow(server):
    post(server, "save", {"name": "Book", "createOnly": True, "project": {"text": "x"}})
    status, body = post(server, "snapshots/create", {"id": "Book", "text": "draft one", "label": "Draft 1"})
    assert status == 200 and body["snapshot"]["kind"] == "manual"
    sid = body["snapshot"]["id"]
    assert [s["id"] for s in post(server, "snapshots/list", {"id": "Book"})[1]["snapshots"]] == [sid]
    assert post(server, "snapshots/get", {"id": "Book", "snapshotId": sid})[1]["snapshot"]["text"] == "draft one"
    status, body = post(server, "snapshots/restore", {"id": "Book", "snapshotId": sid, "currentText": "current"})
    assert status == 200 and body["text"] == "draft one" and body["backup"]["kind"] == "auto"
    assert post(server, "snapshots/delete", {"id": "Book", "snapshotId": sid}) == (200, {"ok": True})
    assert post(server, "snapshots/get", {"id": "Book", "snapshotId": sid})[0] == 404


def test_http_refuses_unsafe_ids_and_needs_the_token(server):
    for bad in ["../x", "a/b", ".trash", "x" * 90]:
        assert post(server, "open", {"id": bad})[0] == 400, bad
        assert post(server, "snapshots/list", {"id": bad})[0] == 400, bad
    assert post(server, "snapshots/get", {"id": "Book", "snapshotId": "../../x"})[0] == 400
    assert post(server, "list", token=False)[0] == 403
    assert server.request("POST", "/api/projects/nonsense", body={})[0] == 404
