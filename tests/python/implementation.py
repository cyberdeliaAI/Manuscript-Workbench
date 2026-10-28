"""Loads the implementation under test as one flat namespace.

Tests were written against the original single-file app (`mw.preflight`, `mw.SETTINGS_PATH`, ...). The code now lives in the
`manuscript_workbench` package; this facade keeps those names working. Reading a name returns it from the first module that
defines it, and setting a name (monkeypatch) patches the module that *defines* it, so callers inside that module see the change.
"""
from __future__ import annotations

import importlib
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

# Leaf modules first: the defining module of a name must come before modules that merely import it.
MODULE_ORDER = [
    "config", "deps", "http_util", "settings", "textio", "htmlimport", "netsafe", "structure",
    "mdrender", "docx_import", "importers", "docx_export", "preflight", "epub_export", "ai", "project", "server",
]


class Implementation:
    def __init__(self) -> None:
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        object.__setattr__(self, "_modules", [importlib.import_module(f"manuscript_workbench.{name}") for name in MODULE_ORDER])
        object.__setattr__(self, "_previous", {})

    def _defining_module(self, name: str):
        for module in self._modules:
            if name in vars(module):
                return module
        raise AttributeError(name)

    def __getattr__(self, name: str):
        return getattr(self._defining_module(name), name)

    def __setattr__(self, name: str, value) -> None:
        module = self._defining_module(name)
        self._previous.setdefault(name, []).append(getattr(module, name))
        setattr(module, name, value)

    def __delattr__(self, name: str) -> None:
        """pytest's monkeypatch undoes a patch with delattr (it sees no instance attribute): restore the previous value."""
        module = self._defining_module(name)
        stack = self._previous.get(name)
        if not stack:
            raise AttributeError(name)
        setattr(module, name, stack.pop())


def load_implementation() -> Implementation:
    return Implementation()
