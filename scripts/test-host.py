#!/usr/bin/env python3
"""Exercise the real downloaded GAMS Runtime through its CLI (macOS only)."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "tools/gams.app/Contents/MacOS/gams"


def invoke(method, *args):
    process = subprocess.run(
        [str(HOST), "run", "--plug", "dist/plugin.font.wasm", f"font/font::{method}", json.dumps(args)],
        cwd=ROOT, env={**os.environ, "GAMS_APP_CWD": str(ROOT)},
        capture_output=True, text=True, check=True,
    )
    return json.loads(process.stdout)


def require(value, message):
    if not value:
        raise SystemExit(message)


version = (ROOT / "version.txt").read_text().strip()
require(invoke("info").startswith(f"plugin.font {version}"), "Unexpected native Host build identity")
config = {
    "atlas-type": "mtsdf", "codepoints": [32, 65, 86], "size": 32,
    "distance-range": 4, "dimensions": None, "edge-coloring": "ink-trap", "miter-limit": 1,
}
for atlas_type in ("sdf", "psdf", "msdf", "mtsdf"):
    result = invoke("generate-file", "test/fixtures/test-font.ttf", {**config, "atlas-type": atlas_type})
    resource = result["ok"]
    require(resource["$resource"] == "gams:font/font" and resource["id"].startswith("res_"),
            "Native Host did not return a font resource")
require(invoke("open", "test/fixtures/absent.arfont")["err"]["code"] == "io-error", "Expected file error")
require(invoke("decode", [1, 2, 3])["err"]["code"] == "invalid-artery", "Expected Artery error")
print("PASS: real downloaded GAMS Host links plugin, invokes all atlas generators and reports structured errors")
