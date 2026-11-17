# plugin.font

Font-atlas backend and View for [GAMS](https://github.com/kkgams/gams).
Generate SDF, PSDF, MSDF and MTSDF atlases; preview text and export Artery,
linked JSON and channel-preserving PNG. Artery support accepts one Unicode
variant and one raw unsigned 8-bit image; unsupported layouts are rejected.

| Item | Source / output | Screenshot | License / original work |
| --- | --- | --- | --- |
| WASI font component | `src/`, `wit/` → `build.nosync/plugin.font.wasm` | Not applicable | [Apache-2.0](LICENSE); [bundled terms](LICENSES/README.md), [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen), Viktor Chlumsky; FreeType Team |
| Font View | `views/` → `build.nosync/views/view-font.js` | Not available | [Apache-2.0](LICENSE), renderer adapted from Viktor Chlumsky's MIT work; [notices](NOTICE) |

## Development

Use `nix develop` for pinned native/WASI compilers, CMake, Ninja, Rust/Wasmtime
tests, wit-bindgen, wasm-tools, esbuild and dependency-free Node tests. All font
library sources are local under `vendor/`; no sibling checkouts, npm packages,
submodules or system font libraries are required. Initial tool/docs downloads
need network access.

| Command | Purpose |
| --- | --- |
| `make build` | Compile the WASI Preview 2 component and bundle the View. |
| `make check` | Check component/WIT and JavaScript syntax. |
| `make test` | Native CTest, renderer tests and real Wasmtime component tests. |
| `make test-host` | Optional real downloaded GAMS CLI integration on macOS. |
| `make package` | Incremental `build.nosync/plugin.font.zip`, raw WASM and `SHA256SUMS`; no publication. |
| `make open` | Build and launch this Project in `tools/gams.app` (macOS Apple Silicon). |
| `make docs` | Build pinned wiki documentation to `build.nosync/site/`. |
| `make serve-docs DOCS_PORT=8081` | Serve docs independently from the application (default 8080). |
| `make validate-docs` | Validate wiki content. |
| `make clean` | Remove all of `build.nosync/`, `tools/` and `gams_modules/`, including unmarked tools/backups; preserve other paths; refuse tracked files/symlinks. |

The ZIP contains the component, View, canonical WIT and complete legal texts.
The public interface remains `gams:font/font@0.1.0`; its version is independent
of release tags. Pixels are bottom-up; resources must be released by callers.
Component file operations use native WASI filesystem preopens. The View uses
`plugin.fs` for all Project reads/writes and the released `view-files`
chooser/saver through `ui.popup`; no browser uploads/downloads are used.

`make open` sets `GAMS_APP_CWD` explicitly. It downloads the released Host only
when absent, preserving notices without bypassing Gatekeeper. The Host installs
pinned supporting Units from `gams.json`. Everything under `build.nosync/`,
`tools/` and `gams_modules/` is disposable; do not store authored files or
irreplaceable data there. Native CLI tests do not establish GUI compatibility.

This Project requires GAMS 3.2.0 or newer for native `$file` configuration
resolution. An older cached Host can report `Unit source must be a non-empty
string`. To explicitly replace it while preserving the old app and notices,
move `tools/gams.app` and its accompanying `tools/gams-release-notices` outside
those paths, then run `make open`. The downloader installs the latest released GAMS
only when the app is absent. `make clean && make open` removes all local tools
and Unit caches, then rebuilds and downloads fresh dependencies, including the
latest Host. No ownership marker is required for cleanup.

## Linked font export

Artery (`.arfont`) is the native save format. **Save** updates the current
Artery file, asking for a destination on first save. **Save as** always asks for
a destination and makes it the current save path after success. Opening a
TTF/OTF clears that destination; saving never changes the generation source.
Header controls also open Project TTF/OTF/Artery fonts and **Export JSON + PNG**
using one Files popup. A separate viewport group provides
**Zoom in**, **Zoom out**, and **Fit preview**, enabled once an atlas is loaded.
Choose a TTF/OTF and press **Generate**;
opening Artery restores its atlas directly. All paths are inside the Project.
Saves replace existing destinations via temporary-file write and rename; parent
directories must already exist (create them in the Files popup).

The View exports `gams.font` version-1 JSON: existing `atlas`, `metrics`, `glyphs`
and `kerning` plus `format: "gams.font"`, `version: 1` and `image`, a PNG path
relative to the Project root (not the JSON directory). Choose a JSON destination
once: `fonts/title.json` writes that file and `fonts/title.png`. Only the final
`.json` extension is replaced, so `title.font.json` produces `title.font.png`.
Both destinations are replaced if they exist. PNG is written before JSON;
the pair is not atomic. If JSON fails after PNG succeeds, the error reports the
partial export; export again to complete the pair.
PNG rows are top-down; metadata atlas bounds remain bottom-origin pixels.
Plane bounds, advances, kerning and metrics use em; atlas size uses pixels/em.
See [the exact export contract](docs/index.md#linked-json--png-export) for units,
coordinate conversion and distance-channel handling. Raw component metadata,
WIT and Artery exports are unchanged.

This software is based in part on the work of the FreeType Team.
Portions of this software are copyright © 2025 The FreeType Project (www.freetype.org). All rights reserved.
FreeType uses the FTL, not its GPL alternative. Retain [NOTICE](NOTICE) and
[complete third-party licenses](LICENSES/README.md) when redistributing, including
raw WASM. Font data and generated assets retain their own applicable rights.
