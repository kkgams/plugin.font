"""Remove disposable build output, local tools and installed Unit caches."""
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
# These directories are explicitly disposable, including unmarked downloads.
# Do not infer other deletion targets from Git's ignore rules.
paths = ["build.nosync", "tools", "gams_modules"]
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
