#!/usr/bin/env python3
"""Package the built font component without source or build intermediates."""

import argparse
import hashlib
from pathlib import Path
import re
import sys
import zipfile


SEMVER = re.compile(
    r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
)
INPUTS = (
    ("dist/plugin.font.wasm", "plugin.font.wasm"),
    ("LICENSE", "LICENSE"),
    ("NOTICE", "NOTICE"),
    ("README.md", "README.md"),
    ("wit/package.wit", "wit/package.wit"),
    ("dist/views/view-font.js", "views/view-font.js"),
)


def package(root: Path, tag: str | None = None) -> Path:
    """Validate all inputs, then write a reproducible archive and checksums."""
    version = (root / "version.txt").read_text(encoding="utf-8").strip()
    if SEMVER.fullmatch(version) is None:
        raise ValueError(f"invalid semantic version: {version!r}")
    if tag is not None and tag != f"v{version}":
        raise ValueError(f"tag {tag!r} must match v{version}")

    # Read everything before writing output, so missing inputs never leave a ZIP.
    contents = [(name, (root / source).read_bytes()) for source, name in INPUTS]
    contents.extend(
        (path.relative_to(root).as_posix(), path.read_bytes())
        for path in sorted((root / "wit/deps").rglob("*.wit"))
    )
    licenses = sorted(path for path in (root / "LICENSES").rglob("*") if path.is_file())
    if not licenses:
        raise ValueError("LICENSES must contain third-party license files")
    contents.extend(
        (path.relative_to(root).as_posix(), path.read_bytes()) for path in licenses
    )
    archive = root / "dist" / f"plugin.font-{version}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as output:
        for name, data in contents:
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, data)

    wasm = root / "dist" / "plugin.font.wasm"
    checksums = "".join(
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n"
        for path in (wasm, archive)
    )
    (root / "dist" / "SHA256SUMS").write_text(checksums, encoding="utf-8")
    return archive


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", help="require a tag matching vVERSION")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    try:
        archive = package(args.root, args.tag)
    except (OSError, ValueError) as error:
        print(f"package: {error}", file=sys.stderr)
        return 1
    print(archive)
    return 0


if __name__ == "__main__":
    sys.exit(main())
