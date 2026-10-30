# plugin.font

An independently maintained GAMS font atlas component and View. Generate SDF,
PSDF, MSDF and MTSDF atlases from font bytes or Project paths, open supported
Artery `.arfont` files, preview atlases and sample text, and export Artery,
metadata JSON and channel-preserving PNG from the View.

The C++ backend builds natively and as a WASI Preview 2 component exporting
`gams:font/font@0.1.0`. Its immutable font resources expose atlas details,
bottom-up unsigned 8-bit pixels, JSON metadata and Artery encoding. Initial
Artery support is deliberately limited to one Unicode variant and one raw
8-bit atlas image; unsupported encodings and multiple variants/images are
rejected, not silently discarded.

## Build and check

Install Nix with flakes enabled:

```sh
nix develop
make build          # WASI backend and self-contained View bundle
make check          # component and local Project validation
make test           # engine, runtime and packaging regression checks
make package        # component + Views ZIP and SHA256SUMS
make ci             # checks, tests, docs validation and packaging
```

The pinned shell supplies the native and WASI compilers, CMake, Ninja,
wit-bindgen, wasm-tools, esbuild and Node.js. `make test` installs its locked
jco runtime-test tooling through npm; no JavaScript generator runs in the View. Initial toolchain and docs-engine
downloads require network access. Font libraries are maintained as local source
under `vendor/`: no submodules, source downloads or synchronization step are
required. Builds do not require system FreeType, HarfBuzz, PNG, Brotli or bzip2;
FreeType's bundled zlib supports its gzip module.

`wit/package.wit` is the public contract; `src/` owns the backend and `views/`
the shipped UI. Root CMake builds the backend for native and WASI targets.
`version.txt` controls the artifact version. See [development details](docs/index.md).

## Open the local Project

```sh
nix develop
make tools/gams.app  # download released Host once (macOS Apple Silicon)
make open            # build and open this repository's gams.json Project
```

The local Project loads `dist/plugin.font.wasm` and `dist/views/view-font.js`.
The latter is built from local `views/` source into one module because the Host
loads Views from blob URLs, where relative module imports cannot resolve.
Use the View's file input for font/Artery bytes or its path controls for files
inside the Host-granted Project filesystem. The component does not import
`plugin.fs`: its path exports call native WASI filesystem descriptors directly.

No neighboring checkouts are required. `make open` sets `GAMS_APP_CWD` and
also downloads the Host when absent; it never updates an existing app silently.
Host notices remain in `tools/gams-release-notices/`. The download does not
remove quarantine or bypass Gatekeeper. First startup installs the pinned
Project Units into ignored `gams_modules/`. Rebuild and reopen after backend
changes; the component is not hot-reloaded.

`make test-backend` runs native engine tests; `make test-component` executes the
actual WASI component via jco, including filesystem operations and resource cleanup.
`make test-view` checks renderer data/layout. On macOS, `make test-host` additionally
invokes all atlas generators through the downloaded real GAMS CLI runtime.
The WASI build uses standardized Wasm exception handling for FreeType's validator;
the jco test command enables that feature in the pinned Node.js runtime.

These checks are separate from real Host GUI testing.
A successful build or Project syntax check is not evidence that the native GUI
has been exercised. Hosted publication likewise requires its own verification.

## Documentation

```sh
make serve-docs                     # http://localhost:8080
make serve-docs DOCS_PORT=8081       # independent documentation port
make validate-docs
make docs                           # build/site/; build-docs is an alias
```

These commands use `justgook/wiki` pinned to `v1.4.0`. Downloaded engine and
rendered output stay in ignored `build/`. With GitHub Actions as the Pages
source, every push to `release` deploys docs independently of version tags and
the default branch.

## Release

```sh
make release RELEASE_TAG=v0.1.0
```

This checks and packages locally; it does not publish. The tag must exactly
match `v` plus `version.txt`. Matching version-tag pushes publish:

- `plugin.font.wasm` — direct component download.
- `plugin.font-0.1.0.zip` — component and Views together, WIT, README and legal texts.
- `SHA256SUMS` — digests for the WASM and ZIP, not itself.

The archive excludes source/build intermediates and the development Host.
ZIP metadata and entry order are fixed. Publication uses the automatic GitHub
token, with no manual digest variables or required publication branch, and
does not overwrite existing releases. Review and authorize the version commit
and matching tag separately.

## License and credits

First-party code is Apache-2.0; see `LICENSE`. Adapted msdf-atlas-gen code and
the original web renderer retain Viktor Chlumsky's MIT license (2020–2025),
msdfgen retains MIT (2014–2025), and artery-font-format retains MIT (2020–2024).
FreeType 2.14.1 is used under the FreeType License (FTL), not the GPL alternative.
This software is based in part on the work of the FreeType Team.

Portions of this software are copyright © 2025 The FreeType Project (www.freetype.org). All rights reserved.

See `NOTICE` and [the legal inventory](LICENSES/README.md). Preserve the complete
`LICENSES/` directory and attribution when redistributing the component or ZIP.
Input fonts and generated assets remain subject to the applicable font licenses;
this repository does not grant rights to third-party font data.
