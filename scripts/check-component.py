#!/usr/bin/env python3
"""Verify component encoding and the scaffold's exported WIT contract."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
component = (root / "dist/plugin.font.wasm").read_bytes()
if component[:8] != b"\0asm\x0d\0\x01\0":
    raise SystemExit("Expected a WASM component, not a core module")
wit = (root / "build/extracted.wit").read_text()
for required in ("export gams:font/font@0.1.0;", "info: func() -> string;"):
    if required not in wit:
        raise SystemExit(f"Missing WIT contract: {required}")
print("PASS: WASM component encoding and gams:font/font@0.1.0 export")
