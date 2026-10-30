---
title: Font atlas development
status: reference
---

# Font atlas development

`plugin.font` owns a font atlas backend and its GAMS View in one independently
released Unit archive. The component remains available as a direct WASM asset.
Local C++ source includes the adapted msdf-atlas-gen engine, msdfgen,
artery-font-format and FreeType 2.14.1. These are maintained here as part of the
fork; there is no submodule checkout, upstream fetch or source-sync workflow.

## Build and validate

From the repository root:

```sh
nix develop
make build
make check
make test
make package
```

The pinned Nix shell supplies CMake, Ninja, native/WASI compilers, wit-bindgen,
wasm-tools and supporting tools. Root CMake builds the same engine for native
execution and the WASI component. Bindings are generated from `wit/package.wit`;
generated files and objects remain under ignored `build/`. The deployable
component is `dist/plugin.font.wasm`, not a core WebAssembly module.
`make build` also bundles `views/view-font.js` and its renderer into
`dist/views/view-font.js` using pinned esbuild. The Host evaluates View modules
from blob URLs, so the deployable View must have no relative module imports.
Host-owned `/core` and `/util` imports remain external.

All font-library source is local under `vendor/`. The build does not use system
FreeType or external HarfBuzz, PNG, Brotli or bzip2 libraries. FreeType's gzip
module can use its bundled zlib. This is not a standalone native GUI or a copy
of the upstream command-line application.

`make check` validates component encoding/exports and local Project wiring.
`make test-backend` builds and executes the native engine tests using a small
GAMS-authored synthetic font. `make test-view` checks pixel conversion and text
layout. `make test-component` installs locked jco tooling and executes the actual
WASI component, exercising generation, Artery roundtrips, filesystem I/O and
resource cleanup. FreeType's validator needs standardized Wasm exception handling;
the build and pinned Node.js test command explicitly enable it.

On macOS, `make test-host` additionally invokes all four atlas generators and
structured errors through the downloaded real GAMS CLI runtime. This does not
exercise the complete native GUI. `make ci` combines portable checks, tests,
documentation validation and packaging; native Host checks are separate.

## Public contract

The authoritative interface is `wit/package.wit`: package `gams:font@0.1.0`,
world `font-plugin`, export `gams:font/font@0.1.0`. Release versioning is owned
separately by `version.txt`; change both deliberately when necessary.

| Operation | Purpose |
| --- | --- |
| `info` | Build identity, not atlas metadata. |
| `generate(bytes, config)` | Generate an immutable atlas resource from font bytes. |
| `decode(bytes)` | Decode a supported Artery font into a resource. |
| `atlas-info(font)` | Dimensions, channel format, atlas type, range and size. |
| `atlas-pixels(font)` | Tightly packed, linear unsigned 8-bit pixel bytes, bottom-up. |
| `metadata-json(font)` | Atlas metrics, glyph layout and related metadata as JSON. |
| `encode(font)` | Serialize the resource as Artery bytes. |
| `generate-file(path, config)` | Generate from a file in the granted filesystem. |
| `open(path)` | Decode an Artery file in that filesystem. |
| `save(font, path)` | Write Artery bytes and return the written byte count. |

Resources do not mutate after creation. Callers own the returned resource and
must release it through their runtime's resource lifecycle. Read operations
borrow it; generation/decoding create a new resource instead of replacing one.

Generation config specifies atlas type (`sdf`, `psdf`, `msdf`, `mtsdf`), Unicode
codepoints, glyph size, distance range, optional fixed dimensions, edge coloring
(`simple`, `ink-trap`, `distance`) and miter limit. SDF/PSDF use `r8`, MSDF uses
`rgb8`, and MTSDF uses `rgba8`. Missing glyphs, invalid input/configuration,
insufficient atlas space, resource limits, invalid or unsupported Artery data,
encoding and I/O failures use the structured WIT error code/message result.

The initial Artery subset accepts **one Unicode variant and one raw unsigned
8-bit, bottom-up atlas image**. Multiple variants or images, indexed/non-Unicode
variants, compressed image encodings and unsupported pixel layouts are rejected.
The API does not imply support for every valid Artery file. Consumers must not
assume top-down pixels: flip rows when writing a conventional top-down PNG or
uploading to a renderer that expects that orientation.

Byte operations work without file paths. The WASI path exports use native
`wasi:filesystem` descriptors with explicit read/write rights and Host-granted
preopens. The native engine tests use stdio. Neither implementation imports or
calls `plugin.fs`. Paths remain within the granted filesystem; unavailable or
ungranted paths produce I/O errors. Save does not create parent directories.

## Use the View

```sh
nix develop
make tools/gams.app
make open
```

`make open` builds the local backend, sets `GAMS_APP_CWD` to this repository
and opens its `gams.json` in `tools/gams.app`. No neighboring repositories are
required. The local Project loads the WASM artifact and the self-contained View
bundle built from `views/`, alongside its pinned supporting Units. First startup installs those
Units into ignored `gams_modules/`.

The View provides font/Artery file input, Project-path generation/open controls,
SDF/PSDF/MSDF/MTSDF generation settings, atlas and sample-text previews, and
Artery/JSON/PNG export. Browser-selected files are passed as byte buffers;
Project paths go to the backend's path operations. The UI is a consumer of the
WIT resource API, not a second font engine. PNG export is a View operation,
not an additional backend image encoder or Artery image encoding. PNG encoding
preserves all distance channels, including RGB values where MTSDF alpha is zero;
it does not pass the atlas through Canvas alpha premultiplication.
The View uses the Host's `ViewCanvasBase` for visible-canvas sizing and pan/zoom,
with an offscreen WebGL renderer for distance-field reconstruction.

The Host download target supports macOS Apple Silicon and only installs when
absent. It preserves release notices in `tools/gams-release-notices/`, never
updates an existing app implicitly and never bypasses Gatekeeper or strips
quarantine. Rebuild and reopen after backend edits; there is no component hot
reload. Project checks do not launch the GUI. Native GUI integration and hosted
release/Pages publication must be verified separately.

## Package and release

```sh
make package
cd dist
sha256sum --check SHA256SUMS
```

On macOS, `shasum -a 256 -c SHA256SUMS` is an alternative. For version `0.1.0`,
the artifacts are `plugin.font.wasm`, `plugin.font-0.1.0.zip` and `SHA256SUMS`.
The ZIP carries the component and Views together, README, WIT and legal texts.
The local Project, downloaded Host, installed supporting Units, source, objects,
generated bindings, rendered docs and checksums are not ZIP payloads.

Packaging validates semantic versions and required files, fixes ZIP timestamps,
permissions and ordering, and hashes both the direct component and ZIP. Identical
inputs produce identical archive bytes regardless of input file timestamps.

```sh
make ci
make release RELEASE_TAG=v0.1.0
```

After a matching release is published, a Project can select the component and
View from the same archive (merge these entries into its existing config):

```json
{
  "plugins": ["https://github.com/kkgams/plugin.font/releases/download/v0.1.0/plugin.font-0.1.0.zip#plugin.font.wasm"],
  "ui": {
    "views": {
      "view-font": {
        "url": "https://github.com/kkgams/plugin.font/releases/download/v0.1.0/plugin.font-0.1.0.zip#views/view-font.js",
        "label": "Font"
      }
    }
  }
}
```

The release target checks an exact match against `version.txt` and prepares
local artifacts only. After review and authorization, a matching version-tag
push runs checks/build/package validation and publishes the three assets via
the automatic GitHub token. There is no manual digest variable or required
publication branch, and existing releases are not overwritten.

## Documentation publication

```sh
make validate-docs
make serve-docs DOCS_PORT=8081
make docs
```

The default preview port is `8080`; `DOCS_PORT` is independent of the Host.
All docs targets use `justgook/wiki` pinned to `v1.4.0`; `make docs` writes
`build/site/` and `make build-docs` remains an alias. Engine downloads/output
stay ignored. Every push to `release` builds and deploys docs through GitHub
Pages independently of version tags and the default branch. Manual Pages runs
are likewise restricted to `release`. Set the Pages source to **GitHub Actions**.

## Licensing

Root `LICENSE` covers first-party Apache-2.0 code, not all bundled code.
Adapted msdf-atlas-gen and the original web renderer retain MIT copyright
2020–2025 Viktor Chlumsky; msdfgen retains MIT copyright 2014–2025 Viktor
Chlumsky; artery-font-format retains MIT copyright 2020–2024 Viktor Chlumsky.
The FreeType 2.14.1 engine is used under the **FTL**, not its GPL alternative.
This software is based in part on the work of the FreeType Team.

Portions of this software are copyright © 2025 The FreeType Project (www.freetype.org). All rights reserved.

Distribution must retain `NOTICE` and the `LICENSES/` inventory/texts, including
FreeType's contributed-code and bundled zlib notices and toolchain runtime
notices. Source copyright/license headers remain in place. When modifying
FreeType source, describe the changes as required by FTL; do not remove the
unaltered license text. Font-data rights are separate: verify each input font's
license before distributing generated assets.
