"""Bundle the Python server for the desktop app (PyInstaller --onedir).

Built on every platform by tools/build_desktop.py, because a frozen server only runs on the system it was built on.
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH).parent

# The server reads its page and the user guide from next to the package (manuscript_workbench/config.py).
datas = [(str(root / "static"), "static"), (str(root / "USER_GUIDE.md"), ".")]
binaries = []
hiddenimports = ["manuscript_workbench.desktop_host"]

# Packages that load data files or modules by name at run time, which PyInstaller cannot see by itself:
# the DOCX template, the Markdown extensions, trafilatura and what it uses to find the main text of a page.
for package in (
    "docx",
    "markdown",
    "trafilatura",
    "courlan",
    "htmldate",
    "justext",
    "dateparser",
    "tld",
    "babel",
    "certifi",
    "lxml_html_clean",
):
    package_datas, package_binaries, package_hiddenimports = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hiddenimports

analysis = Analysis(
    [str(root / "tools" / "desktop_backend_entry.py")],
    pathex=[str(root)],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "_pytest"],
)
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, [], exclude_binaries=True, name="manuscript-workbench-server", console=True, upx=False)
collection = COLLECT(exe, analysis.binaries, analysis.datas, name="manuscript-workbench-server", upx=False)
