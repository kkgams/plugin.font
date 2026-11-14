"""Remove recreatable output and owned downloads, never supplied tools or Units."""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
paths = ["build.nosync"]
marker = ROOT / "tools/gams-release-notices/.gams-managed"
if marker.is_symlink():
    raise SystemExit("Refusing symlink Host ownership marker")
if marker.is_file() and marker.read_text() == "plugin.font Makefile Host download\n":
    paths += ["tools/gams.app", "tools/gams-release-notices"]
# Supplied Host apps, installed Units, legacy build/dist/npm and unrelated files
# are deliberately preserved. All new recreatable output is build.nosync.
for name in paths:
    path = ROOT / name
    for part in (path, *path.parents):
        if part == ROOT:
            break
        if part.is_symlink():
            raise SystemExit(f"Refusing symlink in clean path: {part}")
    if path.is_dir() and any(p.is_symlink() for p in path.rglob("*")):
        raise SystemExit(f"Refusing nested symlink in clean path: {name}")
    tracked = subprocess.check_output(["git", "ls-files", "--", name], cwd=ROOT, text=True)
    if tracked:
        raise SystemExit(f"Refusing tracked clean files:\n{tracked}")
for name in paths:
    path = ROOT / name
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()
