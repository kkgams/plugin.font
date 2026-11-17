---
title: Font atlas
status: reference
---

# Font atlas

Font-atlas backend and View for [GAMS](https://github.com/kkgams/gams).
Generate SDF, PSDF, MSDF and MTSDF atlases, preview atlas/sample text, and export
Artery, linked JSON and channel-preserving PNG.

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
| `make clean` | Remove all of `build.nosync/`, `tools/` and `gams_modules/`, including unmarked tools/backups; preserve other paths; refuse tracked files/symlinks. |

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

## Linked JSON + PNG export

The header's **Open font**, **Save Artery font**, **Export linked JSON** and
**Export atlas PNG** controls use `view-files` chooser/saver popups through
`ui.popup`. All View file reads and writes go through `plugin.fs`, without native
browser upload/download dialogs. Open a Project TTF/OTF, then press **Generate**;
opening an Artery font restores its atlas directly.

Export **atlas PNG first**. A successful save updates **Atlas Project path**
(initially `font.png`) to the chosen Project path. Then export **linked JSON**;
the suggested basename follows the PNG (`font.font.json` for `font.png`).
The JSON can live anywhere in the Project: `image` is relative to the Project
root, **not** the JSON file's directory. If you move/re-export the PNG, export
JSON again to update its reference. Each save writes a temporary sibling file
then renames it over the destination; an existing destination is replaced.
Parent directories must already exist; the Files popup can create folders.
Cancelling a picker does not write files. Use a nonempty
`/`-separated PNG path, without leading `/`, empty/`.`/`..` segments, backslashes,
URL syntax, control characters or surrounding whitespace.

The UTF-8 JSON object retains the component's complete `atlas`, `metrics`,
`glyphs` and `kerning` values and adds exactly these contract fields:

```json
{
  "format": "gams.font",
  "version": 1,
  "image": "fonts/font.png"
}
```

These are additional fields, not a complete font document. The component's
`metadata-json` export remains raw metadata without these fields; its WIT and
Artery encoding/decoding are unchanged.

| Field | Meaning / units |
| --- | --- |
| `atlas.type` | `sdf`, `psdf`, `msdf` or `mtsdf`. |
| `atlas.width`, `atlas.height` | PNG dimensions in pixels. |
| `atlas.size` | Atlas generation scale, pixels per em. |
| `atlas.distanceRange` | Total encoded distance span in atlas pixels; the edge is at channel value 0.5. |
| `atlas.distanceRangeMiddle` | Distance-span midpoint in atlas pixels; currently always 0. |
| `atlas.yOrigin` | Always `bottom`; retained even though PNG rows are top-down. |
| `metrics` | `emSize`, `lineHeight`, `ascender`, `descender`, `underlineY`, `underlineThickness`; normalized em units (`emSize` is 1 for generated fonts). |
| `glyphs[].unicode` | Unicode scalar value, not a UTF-16 index. |
| `glyphs[].advance` | Horizontal pen advance in em. |
| `glyphs[].planeBounds` | `left`, `bottom`, `right`, `top` in em relative to pen/baseline; positive Y points up. |
| `glyphs[].atlasBounds` | Same four edges in atlas pixels, measured from the bottom-left; values may be fractional. |
| `kerning[]` | `unicode1`, `unicode2` identify a pair; `advance` is an additive horizontal adjustment in em before the second glyph. |

Glyphs without drawable bounds (such as spaces) retain their advance and have
no quad. Scale plane bounds, advances, kerning and line height by the desired
text size in pixels per em; do not use atlas rectangle sizes for text layout.
For a top-left-origin PNG rectangle use `x = left`, `y = atlas.height - top`,
`width = right - left`, `height = top - bottom` from `atlasBounds`. Do not flip
the metadata or the PNG a second time.

PNG output is top-down, unsigned 8-bit RGBA without gamma conversion or alpha
premultiplication. SDF/PSDF replicate R into RGB with opaque alpha; MSDF keeps
RGB with opaque alpha; MTSDF keeps RGB plus its true-distance alpha, including
RGB samples where alpha is zero. Treat these as linear distance data, not sRGB
color or ordinary transparency; MSDF/MTSDF fill uses the median RGB channel.

## Local Project

`make open` builds local artifacts, sets `GAMS_APP_CWD` to this checkout and
opens its `gams.json`. On macOS Apple Silicon it downloads the released Host
only when absent and retains accompanying notices without bypassing Gatekeeper.
Supporting Units are pinned and installed by the Host into `gams_modules/`.
The Project registers `view-files`, `files-rename` (including folder creation)
and `files-default` from the same released `view.files` archive. Other Projects
hosting this View must register those Views and provide `plugin.fs`, `ui.popup`,
`ui.toast` and `ui.tooltip` as well.
Rebuild/reopen after component changes; there is no component hot reload.
CLI tests do not exercise the native GUI.
