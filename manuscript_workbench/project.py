"""Project files (.mwb.json) and their snapshots.

A project keeps one manuscript with its book metadata, ignored chapter candidates, custom prompts and the AI settings
that belong to it. Snapshots are named restore points of the text. Everything lives in the projects folder; names are
turned into safe ids first, so nothing can be read or written outside that folder.

Layout:  <projects>/<id>.mwb.json            the project (the previous version is kept as <id>.mwb.json.bak)
         <projects>/<id>.snapshots/<sid>.txt   the text of a snapshot
         <projects>/<id>.snapshots/<sid>.meta.json   its label, date and counts (small, so listing is cheap)
         <projects>/.trash/                    deleted projects, moved here rather than erased
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import config
from .http_util import HttpError
from .settings import without_secret_settings
from .textio import safe_filename

PROJECT_FORMAT = "manuscript-workbench-project"
PROJECT_VERSION = 1
PROJECT_SUFFIX = ".mwb.json"
AUTO_SNAPSHOT_LIMIT = 50  # automatic snapshots beyond this are pruned, oldest first; manual ones are kept
PERIODIC_SNAPSHOT_MINUTES = 15
MAX_NAME_LENGTH = 80

METADATA_KEYS = ("title", "subtitle", "author", "language", "series", "bookNumber", "publisher", "filename")
# The AI and typography settings that travel with a project (never secrets, never window layout).
PROJECT_SETTING_KEYS = (
    "lmProvider", "lmBase", "lmModel", "lmStrength", "chunkSize", "guidedContext", "translateTarget",
    "quoteStyle", "dashStyle", "advTemperature", "advTopP", "advTopK", "advRepeatPenalty", "advMaxTokens", "docxLists",
)

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
_SNAPSHOT_ID_RE = re.compile(r"^[0-9]{8}T[0-9]{12}Z-(?:auto|manual)$")
_lock = threading.RLock()  # one writer at a time: the server is multi-threaded and autosave can overlap a manual save


def projects_dir() -> Path:
    return Path(config.PROJECTS_DIR)


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="microseconds")


# ---- names, ids and paths ----------------------------------------------------------------------

def project_id_for_name(name: Any) -> str:
    """The id (file name) for a project name: letters, digits, dot, dash and underscore only."""
    pid = safe_filename(str(name or ""), "")[:MAX_NAME_LENGTH].strip("-._")
    if not pid or not _ID_RE.match(pid):
        raise HttpError(400, "Give the project a name with letters or digits.", "bad-name")
    return pid


def check_id(pid: Any) -> str:
    if not isinstance(pid, str) or not _ID_RE.match(pid):
        raise HttpError(400, "Invalid project id.", "bad-id")
    return pid


def _file(pid: str) -> Path:
    return projects_dir() / f"{check_id(pid)}{PROJECT_SUFFIX}"


def _snapshots_dir(pid: str) -> Path:
    return projects_dir() / f"{check_id(pid)}.snapshots"


def _atomic_write(path: Path, data: str) -> None:
    """Write to a temporary file in the same folder, flush it to disk, then rename it over the target."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _counts(text: str) -> Dict[str, int]:
    return {"words": len(text.split()), "chars": len(text)}


# ---- project content ---------------------------------------------------------------------------

def normalize_project(raw: Any) -> Dict[str, Any]:
    """Validates and cleans the content of a project. Unknown fields are dropped, secrets are never kept."""
    if not isinstance(raw, dict):
        raise HttpError(400, "The project must be a JSON object.", "bad-project")
    text = raw.get("text", "")
    if not isinstance(text, str):
        raise HttpError(400, "The project text must be a string.", "bad-project")
    meta_in = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    metadata = {k: str(v)[:500] for k, v in meta_in.items() if k in METADATA_KEYS and isinstance(v, (str, int, float))}
    glossary = raw.get("glossary") if isinstance(raw.get("glossary"), str) else ""
    ignored_in = raw.get("ignoredCandidates") if isinstance(raw.get("ignoredCandidates"), list) else []
    ignored = [k[:300] for k in ignored_in if isinstance(k, str)][:5000]
    prompts_in = raw.get("customPrompts") if isinstance(raw.get("customPrompts"), list) else []
    prompts = [
        {"name": p["name"][:200], "text": p["text"]}
        for p in prompts_in
        if isinstance(p, dict) and isinstance(p.get("name"), str) and isinstance(p.get("text"), str) and p["name"].strip()
    ][:100]
    settings_in = without_secret_settings(raw.get("settings"))
    settings = {k: v for k, v in settings_in.items() if k in PROJECT_SETTING_KEYS and isinstance(v, (str, int, float, bool))}
    return {"text": text, "metadata": metadata, "glossary": glossary, "ignoredCandidates": ignored, "customPrompts": prompts, "settings": settings}


def _read_file(path: Path) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HttpError(422, f"The project file could not be read: {exc}", "unreadable") from None
    if not isinstance(data, dict) or data.get("format") != PROJECT_FORMAT:
        raise HttpError(422, "This is not a Manuscript Workbench project file.", "not-a-project")
    if not isinstance(data.get("version"), int) or data["version"] > PROJECT_VERSION:
        raise HttpError(422, "This project was made by a newer version of Manuscript Workbench.", "newer-version")
    return data


def _summary(pid: str, data: Dict[str, Any]) -> Dict[str, Any]:
    text = data.get("text") if isinstance(data.get("text"), str) else ""
    return {"id": pid, "name": data.get("name") or pid, "createdAt": data.get("createdAt"), "updatedAt": data.get("updatedAt"), **_counts(text)}


def read_project(pid: str) -> Dict[str, Any]:
    path = _file(pid)
    if not path.is_file():
        raise HttpError(404, "That project does not exist.", "not-found")
    data = _read_file(path)
    clean = normalize_project(data)
    return {"id": pid, "name": data.get("name") or pid, "createdAt": data.get("createdAt"), "updatedAt": data.get("updatedAt"), **clean}


def list_projects() -> List[Dict[str, Any]]:
    folder = projects_dir()
    out: List[Dict[str, Any]] = []
    if folder.is_dir():
        for path in folder.glob(f"*{PROJECT_SUFFIX}"):
            pid = path.name[: -len(PROJECT_SUFFIX)]
            if not _ID_RE.match(pid):
                continue
            try:
                summary = _summary(pid, _read_file(path))
            except HttpError:
                continue  # a damaged or foreign file does not break the list
            summary["snapshots"] = len(_snapshot_ids(pid))
            out.append(summary)
    out.sort(key=lambda p: (str(p.get("updatedAt") or ""), p["id"]), reverse=True)  # newest first; the id breaks ties
    return out


def save_project(
    name: str,
    raw: Any,
    *,
    project_id: Optional[str] = None,
    base_updated_at: Optional[str] = None,
    create_only: bool = False,
    force: bool = False,
    periodic_snapshot: bool = False,
) -> Dict[str, Any]:
    """Creates or updates a project.

    `create_only` refuses to touch an existing project (a new project, or Save As). Otherwise an existing project is
    only overwritten when `base_updated_at` matches the file (nobody else saved in between) or `force` is set.
    """
    display = str(name or "").strip()[:120]
    pid = check_id(project_id) if project_id else project_id_for_name(display)
    display = display or pid
    clean = normalize_project(raw)
    with _lock:
        path = _file(pid)
        existing: Optional[Dict[str, Any]] = _read_file(path) if path.is_file() else None
        if existing is not None and not force:
            if create_only:
                raise HttpError(409, "A project with this name already exists.", "exists")
            if base_updated_at is None or existing.get("updatedAt") != base_updated_at:
                raise HttpError(409, "This project was changed somewhere else (another tab or window) since you opened it.", "conflict")
        created = (existing or {}).get("createdAt") or now_iso()
        record = {"format": PROJECT_FORMAT, "version": PROJECT_VERSION, "name": display, "createdAt": created, "updatedAt": now_iso(), **clean}
        if existing is not None:
            shutil.copy2(path, path.with_name(path.name + ".bak"))
        _atomic_write(path, json.dumps(record, ensure_ascii=False, indent=2))
        if periodic_snapshot and existing is not None and existing.get("text") != clean["text"]:
            _periodic_snapshot(pid, clean["text"])
        return _summary(pid, record)


def delete_project(pid: str) -> None:
    """Moves the project, its backup and its snapshots into projects/.trash/ (nothing is erased)."""
    path = _file(pid)
    with _lock:
        if not path.is_file():
            raise HttpError(404, "That project does not exist.", "not-found")
        target = projects_dir() / ".trash" / f"{pid}-{_dt.datetime.now(_dt.timezone.utc).strftime('%Y%m%dT%H%M%S')}"
        target.mkdir(parents=True, exist_ok=True)
        shutil.move(str(path), str(target / path.name))
        bak = path.with_name(path.name + ".bak")
        if bak.exists():
            shutil.move(str(bak), str(target / bak.name))
        snaps = _snapshots_dir(pid)
        if snaps.is_dir():
            shutil.move(str(snaps), str(target / snaps.name))


# ---- snapshots ---------------------------------------------------------------------------------

def _snapshot_ids(pid: str) -> List[str]:
    folder = _snapshots_dir(pid)
    if not folder.is_dir():
        return []
    ids = [p.name[: -len(".meta.json")] for p in folder.glob("*.meta.json")]
    return sorted((i for i in ids if _SNAPSHOT_ID_RE.match(i)), reverse=True)  # newest first


def _read_meta(pid: str, sid: str) -> Optional[Dict[str, Any]]:
    try:
        return json.loads((_snapshots_dir(pid) / f"{sid}.meta.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def list_snapshots(pid: str) -> List[Dict[str, Any]]:
    check_id(pid)
    return [meta for meta in (_read_meta(pid, sid) for sid in _snapshot_ids(pid)) if meta]


def _require_project(pid: str) -> None:
    if not _file(pid).is_file():
        raise HttpError(404, "That project does not exist.", "not-found")


def create_snapshot(pid: str, text: Any, *, kind: str = "manual", label: str = "", reason: str = "") -> Dict[str, Any]:
    """Stores a restore point. An automatic snapshot of text that is already the newest snapshot is not repeated."""
    if kind not in ("auto", "manual"):
        raise HttpError(400, "A snapshot is either 'auto' or 'manual'.", "bad-snapshot")
    if not isinstance(text, str):
        raise HttpError(400, "The snapshot text must be a string.", "bad-snapshot")
    _require_project(pid)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    with _lock:
        newest = (list_snapshots(pid) or [None])[0]
        if kind == "auto" and newest and newest.get("sha256") == digest:
            return {**newest, "duplicate": True}
        folder = _snapshots_dir(pid)
        folder.mkdir(parents=True, exist_ok=True)
        while True:
            sid = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%S%f") + f"Z-{kind}"
            if not (folder / f"{sid}.meta.json").exists():
                break
            time.sleep(0.001)
        meta = {"id": sid, "kind": kind, "label": str(label or "")[:200], "reason": str(reason or "")[:200],
                "createdAt": now_iso(), "sha256": digest, **_counts(text)}
        _atomic_write(folder / f"{sid}.txt", text)
        _atomic_write(folder / f"{sid}.meta.json", json.dumps(meta, ensure_ascii=False))  # the meta file marks it complete
        if kind == "auto":
            _prune_auto_snapshots(pid)
        return meta


def _prune_auto_snapshots(pid: str) -> None:
    autos = [sid for sid in _snapshot_ids(pid) if sid.endswith("-auto")]  # newest first
    for sid in autos[AUTO_SNAPSHOT_LIMIT:]:
        _remove_snapshot_files(pid, sid)


def _remove_snapshot_files(pid: str, sid: str) -> None:
    for suffix in (".meta.json", ".txt"):
        try:
            (_snapshots_dir(pid) / f"{sid}{suffix}").unlink()
        except OSError:
            pass


def _check_snapshot_id(sid: Any) -> str:
    if not isinstance(sid, str) or not _SNAPSHOT_ID_RE.match(sid):
        raise HttpError(400, "Invalid snapshot id.", "bad-id")
    return sid


def get_snapshot(pid: str, sid: Any) -> Dict[str, Any]:
    check_id(pid)
    sid = _check_snapshot_id(sid)
    meta = _read_meta(pid, sid)
    if not meta:
        raise HttpError(404, "That snapshot does not exist.", "not-found")
    try:
        text = (_snapshots_dir(pid) / f"{sid}.txt").read_text(encoding="utf-8")
    except OSError:
        raise HttpError(404, "That snapshot does not exist.", "not-found") from None
    return {**meta, "text": text}


def delete_snapshot(pid: str, sid: Any) -> None:
    check_id(pid)
    sid = _check_snapshot_id(sid)
    with _lock:
        if not _read_meta(pid, sid):
            raise HttpError(404, "That snapshot does not exist.", "not-found")
        _remove_snapshot_files(pid, sid)


def restore_snapshot(pid: str, sid: Any, current_text: Any = None) -> Dict[str, Any]:
    """Returns the snapshot text. The text being replaced is snapshotted first, so a restore can itself be undone."""
    snap = get_snapshot(pid, sid)
    backup = None
    if isinstance(current_text, str):
        label = snap.get("label") or snap.get("createdAt") or snap["id"]
        backup = create_snapshot(pid, current_text, kind="auto", reason=f"Before restoring {label}")
    meta = {k: v for k, v in snap.items() if k != "text"}
    return {"text": snap["text"], "snapshot": meta, "backup": backup}


def _periodic_snapshot(pid: str, text: str) -> None:
    """A restore point every PERIODIC_SNAPSHOT_MINUTES of work, so the .bak is not the only history of an autosaved project."""
    newest = (list_snapshots(pid) or [None])[0]
    if newest:
        try:
            age = _dt.datetime.now(_dt.timezone.utc) - _dt.datetime.fromisoformat(str(newest["createdAt"]))
        except (KeyError, ValueError):
            age = _dt.timedelta(days=1)
        if age < _dt.timedelta(minutes=PERIODIC_SNAPSHOT_MINUTES):
            return
    create_snapshot(pid, text, kind="auto", reason="Periodic")
