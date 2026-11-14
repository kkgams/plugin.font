#!/usr/bin/env python3
"""Verify component encoding, native filesystem imports and public WIT exports."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
component = (root / "build.nosync/plugin.font.wasm").read_bytes()
if component[:8] != b"\0asm\x0d\0\x01\0":
    raise SystemExit("Expected a WASM component, not a core module")
wit = (root / "build.nosync/extracted.wit").read_text()
for required in (
    "export gams:font/font@0.1.0;", "info: func() -> string;", "resource font;",
    "generate: func(", "decode: func(", "encode: func(", "atlas-info: func(",
    "atlas-pixels: func(", "metadata-json: func(", "generate-file: func(",
    "open: func(", "save: func(", "import wasi:filesystem/types@",
    "import wasi:filesystem/preopens@",
):
    if required not in wit:
        raise SystemExit(f"Missing WIT contract: {required}")
if "import gams:fs" in wit:
    raise SystemExit("Plugins must use native WASI filesystem imports, not plugin.fs")
print("PASS: WASM component encoding and gams:font/font@0.1.0 export")
