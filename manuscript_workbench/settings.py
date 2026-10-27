"""Persistent app settings (never stores secrets)."""
from __future__ import annotations

import datetime as _dt
import json
from typing import Any, Dict

from .config import APP_VERSION, ROOT_DIR, SECRET_SETTING_KEYS

SETTINGS_PATH = ROOT_DIR / "manuscript_workbench_settings.json"


def settings_path():
    """The settings file location (looked up at call time so tests can redirect SETTINGS_PATH)."""
    return SETTINGS_PATH


def without_secret_settings(settings: Any) -> Dict[str, Any]:
    if not isinstance(settings, dict):
        return {}
    return {key: value for key, value in settings.items() if key not in SECRET_SETTING_KEYS}


def read_app_settings() -> Dict[str, Any]:
    try:
        if SETTINGS_PATH.exists():
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return {}
            if "settings" in data:
                data["settings"] = without_secret_settings(data["settings"])
            return data
    except Exception:
        return {}
    return {}


def write_app_settings(settings: Dict[str, Any]) -> None:
    payload = {
        "version": APP_VERSION,
        "savedAt": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "settings": without_secret_settings(settings),
    }
    tmp = SETTINGS_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(SETTINGS_PATH)


def scrub_stored_secrets() -> bool:
    """Remove secrets that an older version wrote to the settings file. Returns True if the file was cleaned."""
    try:
        if not SETTINGS_PATH.exists():
            return False
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return False
    stored = data.get("settings") if isinstance(data, dict) else None
    if not isinstance(stored, dict) or not any(key in stored for key in SECRET_SETTING_KEYS):
        return False
    write_app_settings(stored)
    return True
