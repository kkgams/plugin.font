---
title: Font component development
status: reference
---

# Font component development

`plugin.font` is a C++ WASI Preview 2 component scaffold, not a working font
backend. Its only operation returns build identity. Font conversion, atlas
generation, font metrics, glyph rendering and Artery decoding are not
implemented. The build does not incorporate msdf-atlas-gen, msdfgen or FreeType.

## Build the component

Install Nix with flakes enabled, then run from the repository root:

```sh
nix develop
make build
make check
make test
```

The pinned shell provides WASI SDK 33.0, wit-bindgen 0.57.1, wasm-tools 1.248.0,
Python 3, Make, curl, Git, Node.js and unzip. Initial downloads require network access.
`make build` generates C bindings from `wit/package.wit`, compiles those
bindings and `src/component.cpp`, and links `dist/plugin.font.wasm` as a
component. Generated bindings and objects remain in ignored `build/`.

`make check` uses wasm-tools to validate the artifact, extracts its WIT and
checks the component header and required export. `make test` exercises packaging
with temporary fixtures and validates local Project wiring; it does not test font generation or execute Host integration.

## Public contract

| Contract | Value |
| --- | --- |
| WIT package | `gams:font@0.1.0` |
| World | `font-plugin` |
| Exported interface | `gams:font/font@0.1.0` |
| Operation | `info() -> string` |
| Current result | `plugin.font 0.1.0 (scaffold)` |
| Component artifact | `dist/plugin.font.wasm` |

The result identifies the build version from `version.txt`; it is not a font
capability or conversion result. A component-aware runtime can call this WIT
export. There is no production font View, standalone application or bundled
Host here; the local Project includes only a development smoke View.
The WIT package version describes the interface, while `version.txt` controls
the release version; update either deliberately when its contract changes.

## Run the local Project in GAMS

`gams.json` is a local development Project, patterned after `view.character`.
It pins the filesystem and layout plugins, six UI Services and the98 theme.
The font component is the local `dist/plugin.font.wasm`, not a release URL.
No catalog database or separate font View repository is needed.

```sh
nix develop
make tools/gams.app # download released macOS Apple Silicon Host once
make run            # build plugin and launch tools/gams.app
make run-app        # same launch flow as make run
```

Both launch targets build the font component first and set `GAMS_APP_CWD` to
this repository. `make tools/gams.app` installs the latest official Host ZIP
only if absent, preserving its accompanying notices under
`tools/gams-release-notices/`. It never silently updates an installed Host or
removes quarantine. No neighboring repositories or Host source toolchain are
required. Both launch targets also download the app automatically if absent.

Startup installs the pinned remote Units in ignored `gams_modules/` and mounts
`dev/view-font-smoke.js`. That View uses the real Host runtime to call
`font/font::info` automatically; **Call font.info()** repeats the call.
The result should be `plugin.font 0.1.0 (scaffold)`; invocation failures are
displayed and rethrown. This tests loading and invocation, not font generation.
Rebuild and reopen the Project after component edits; there is no hot reload.

`make check-project` checks config wiring and smoke View syntax without starting
a GUI. Native startup and the displayed result still require a real Host run.
The Project, smoke View, downloaded Host and installed Units are excluded from
the published plugin ZIP.

## Package and verify

```sh
make package
cd dist
sha256sum --check SHA256SUMS
```

For version `0.1.0`, packaging writes `plugin.font-0.1.0.zip` and `SHA256SUMS`
alongside `plugin.font.wasm`. On systems without `sha256sum`, use
`shasum -a 256 -c SHA256SUMS` instead. The archive contains the component,
LICENSE, NOTICE, README.md, `wit/package.wit` and the `LICENSES/` texts. It does
not contain C++ source, generated bindings, objects, docs output or checksums.
Both the direct WASM and ZIP are covered by `SHA256SUMS`.

The packager rejects invalid semantic versions, missing required files, an
empty license directory and mismatching tags before creating an archive. ZIP
metadata and entry ordering are fixed; unchanged inputs produce identical ZIP
bytes independent of input timestamps and permissions.

## Prepare a release

Set `version.txt` to the intended semantic version and document any API changes.
Use a major version for incompatible contracts, minor for compatible additions
and patch for compatible fixes. Keep `info()` explicitly scoped to build
identity until a functional font API is implemented and documented.

```sh
make ci
make release RELEASE_TAG=v0.1.0
```

The release target requires an exact matching tag and only prepares local
artifacts. After review, publish the version commit and its matching tag through
normal Git operations. A tag push runs checks and packaging under Nix, then
GitHub Actions creates a release with the direct WASM, versioned ZIP and
`SHA256SUMS`. The automatic `GH_TOKEN` authorizes publication. There is no
special release branch, manual digest variable or approval-file prerequisite;
existing releases are not overwritten.

## Maintain documentation

Edit this page and run `make validate-docs`. `make serve-docs` serves the docs
at `http://localhost:8080`; set `DOCS_PORT` to avoid port conflicts.
`make build-docs` writes the portable site to `build/site/`. All docs targets
use `justgook/wiki` pinned to `v1.4.0`. The Pages workflow invokes the same build
command and deploys only from the repository's default branch. Configure the
repository's Pages source as **GitHub Actions**.
