"""Focused release-packaging tests; no compiler or network required."""

import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "package.py"
SPEC = importlib.util.spec_from_file_location("font_package", SCRIPT)
PACKAGER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGER)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.inputs = {
            "version.txt": b"0.1.0\n",
            "dist/plugin.font.wasm": b"\x00asm\x0d\x00\x01\x00",
            "LICENSE": b"project license\n",
            "NOTICE": b"notice\n",
            "README.md": b"# Font component scaffold\n",
            "wit/package.wit": b"package gams:font@0.1.0;\n",
            "dist/views/view-font.js": b"// bundled font View and preview renderer\n",
            "LICENSES/wasi-sdk.txt": b"SDK license\n",
            "LICENSES/wit-bindgen.txt": b"bindings license\n",
        }
        for name, data in self.inputs.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    def test_archive_contents_and_checksums(self):
        for name in ("src/font.cpp", "build/font.o", "dist/stale.zip",
                     "gams.json", "dev/view-font-smoke.js", "tools/gams.app/binary"):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"not shipped")
        dep = self.root / "wit/deps/wasi-filesystem/package.wit"
        dep.parent.mkdir(parents=True)
        dep.write_bytes(b"package wasi:filesystem@0.2.0;\n")
        archive = PACKAGER.package(self.root, "v0.1.0")
        expected = {
            "wit/deps/wasi-filesystem/package.wit": dep.read_bytes(),
            "plugin.font.wasm": self.inputs["dist/plugin.font.wasm"],
            **{name: self.inputs[source] for source, name in PACKAGER.INPUTS},
            **{name: data for name, data in self.inputs.items() if name.startswith("LICENSES/")},
        }
        with zipfile.ZipFile(archive) as package:
            self.assertEqual(set(package.namelist()), set(expected))
            for entry in package.infolist():
                self.assertEqual(package.read(entry), expected[entry.filename])
                self.assertEqual(entry.date_time, (1980, 1, 1, 0, 0, 0))
                self.assertEqual(entry.external_attr >> 16, 0o100644)
        checksum_lines = (self.root / "dist/SHA256SUMS").read_text().splitlines()
        self.assertEqual(len(checksum_lines), 2)
        self.assertEqual(checksum_lines, [
            f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}"
            for path in (self.root / "dist/plugin.font.wasm", archive)
        ])

    def test_archive_is_deterministic_despite_input_metadata(self):
        archive = PACKAGER.package(self.root)
        original = archive.read_bytes()
        checksums = (self.root / "dist/SHA256SUMS").read_bytes()
        for name in self.inputs:
            path = self.root / name
            os.utime(path, (1700000000, 1700000000))
            path.chmod(0o600)
        PACKAGER.package(self.root)
        self.assertEqual(archive.read_bytes(), original)
        self.assertEqual((self.root / "dist/SHA256SUMS").read_bytes(), checksums)

    def test_mismatching_tag_is_rejected_before_output(self):
        for tag in ("v0.2.0", "0.1.0", "", "v0.1.0/unsafe"):
            with self.subTest(tag=tag), self.assertRaisesRegex(ValueError, "must match"):
                PACKAGER.package(self.root, tag)
        self.assertFalse(list((self.root / "dist").glob("*.zip")))

    def test_unsafe_or_invalid_versions_are_rejected(self):
        for version in ("../escape", "0.1.0/escape", "v0.1.0", "01.1.0", "0.1", "",
                        "0.1.0-01", "0.1.0\nother", "0.1.0+", "0.1.0-rc..1"):
            with self.subTest(version=version):
                (self.root / "version.txt").write_text(version)
                with self.assertRaisesRegex(ValueError, "invalid semantic version"):
                    PACKAGER.package(self.root)
        self.assertFalse(list((self.root / "dist").glob("*.zip")))

    def test_semantic_prerelease_and_build_versions(self):
        version = "1.2.3-rc.1+build.007"
        (self.root / "version.txt").write_text(version)
        self.assertEqual(PACKAGER.package(self.root, f"v{version}").name,
                         f"plugin.font-{version}.zip")

    def test_each_required_input_is_required(self):
        for name, data in self.inputs.items():
            if name.startswith("LICENSES/"):
                continue
            with self.subTest(name=name):
                path = self.root / name
                path.unlink()
                with self.assertRaises(FileNotFoundError):
                    PACKAGER.package(self.root)
                self.assertFalse(list((self.root / "dist").glob("*.zip")))
                path.write_bytes(data)

    def test_missing_or_empty_licenses_are_rejected(self):
        for path in (self.root / "LICENSES").iterdir():
            path.unlink()
        for missing in (False, True):
            with self.subTest(missing=missing):
                if missing:
                    (self.root / "LICENSES").rmdir()
                with self.assertRaisesRegex(ValueError, "LICENSES must contain"):
                    PACKAGER.package(self.root)

    def test_cli_reports_invalid_tag(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root), "--tag", "v9.9.9"],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("must match v0.1.0", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
