---
title: Font atlas
status: reference
---

# Font atlas

Font-atlas backend and View for [GAMS](https://github.com/kkgams/gams).
Generate SDF, PSDF, MSDF and MTSDF atlases, preview atlas/sample text, and export
Artery, metadata JSON and channel-preserving PNG.

| Item | Source / output | Screenshot |
| --- | --- | --- |
| WASI component | `src/`, `wit/` → `build.nosync/plugin.font.wasm` | Not applicable |
| Font View | `views/` → `build.nosync/views/view-font.js` | Not available |

## Development

Enter `nix develop` for the pinned C++/WASI/Rust toolchain, CMake, Ninja,
wit-bindgen, wasm-tools, esbuild and dependency-free Node tests. Font libraries
are local under `vendor/`; no sibling checkout or npm ecosystem is required.
Toolchain and documentation downloads require network access.

| Command | Purpose |
| --- | --- |
| `make build` | Compile the component and self-contained View bundle. |
| `make check` | Validate component/WIT and JavaScript syntax. |
| `make test` | Native engine, renderer and real Wasmtime component tests. |
| `make test-host` | Optional real GAMS CLI test on macOS. |
| `make package` | Build incremental ZIP, raw WASM and checksums in `build.nosync/`. |
| `make open` | Build and launch local Project in downloaded released GAMS. |
| `make docs` | Build documentation to `build.nosync/site/`. |
| `make serve-docs DOCS_PORT=8081` | Serve documentation; default port 8080. |
| `make validate-docs` | Validate documentation. |
| `make clean` | Remove `build.nosync/` and marked downloaded Host/notices; preserve supplied tools/Units and legacy output; refuse tracked files/symlinks. |

## Component contract

Canonical WIT exports `gams:font/font@0.1.0`. `generate`/`decode` create immutable
resources; `atlas-info`, `atlas-pixels`, `metadata-json` and `encode` borrow them.
Callers must release resources. `generate-file`, `open` and `save` operate through
Host-granted native WASI filesystem preopens; no `plugin.fs` import is used.
Save does not create parent directories.

Configuration selects Unicode codepoints, atlas type, size, distance range,
optional dimensions, edge coloring and miter limit. Pixels are bottom-up,
tightly packed unsigned 8-bit channels: SDF/PSDF use R8, MSDF RGB8, MTSDF RGBA8.
Flip rows for conventional top-down PNG. The View preserves every distance
channel, including RGB where MTSDF alpha is zero.

Artery decoding accepts one Unicode variant and one raw 8-bit image only.
Unsupported encodings, multiple variants/images, invalid fonts/configuration,
missing glyphs, oversized atlases and filesystem failures return structured
errors rather than discarding data.

## Local Project

`make open` builds local artifacts, sets `GAMS_APP_CWD` to this checkout and
opens its `gams.json`. On macOS Apple Silicon it downloads the released Host
only when absent and retains accompanying notices without bypassing Gatekeeper.
Supporting Units are pinned and installed by the Host into `gams_modules/`.
Rebuild/reopen after component changes; there is no component hot reload.
CLI tests do not exercise the native GUI.
