# plugin.font

A minimal C++ WASI Preview 2 component scaffold. It exports
`gams:font/font@0.1.0` with `info() -> string`, returning
`plugin.font 0.1.0 (scaffold)` as build identity only.

**This is not a font-generation backend.** It does not generate atlases,
convert fonts, decode Artery files, or integrate msdf-atlas-gen, msdfgen or
FreeType.

## Build and check

Install Nix with flakes enabled. The pinned development shell supplies WASI
SDK, wit-bindgen, wasm-tools, Python 3, Make, curl, Git, Node.js and unzip. First use requires
network access to fetch the toolchain and documentation engine.

```sh
nix develop
make build          # dist/plugin.font.wasm: a component, not a core module
make check          # validate component encoding and exported WIT
make test           # packaging and local Project regression tests
make package        # build/check, then ZIP and SHA256SUMS
make ci             # component checks, tests, docs validation and packaging
```

Source lives in `src/component.cpp`; the public interface is `wit/package.wit`.
`version.txt` owns the artifact version, initially `0.1.0`. Changing this
scaffold does not implement a font API; document and version new contracts
explicitly. See [development and release details](docs/index.md).

## Run in GAMS

The local `gams.json` follows `view.character`: pinned filesystem/layout
plugins, all six UI Services and the98 theme, with the font plugin loaded
directly from `dist/plugin.font.wasm`. A development-only smoke View calls
`font/font::info` on mount and provides a button to repeat the call.

```sh
nix develop
make tools/gams.app  # download released Host once (macOS Apple Silicon)
make run             # build plugin and open this Project in tools/gams.app
# make run-app is an alias for the same launch flow
```

No neighboring repositories are required. `make run` also downloads the Host
if it is absent; existing downloads are never updated implicitly. Downloaded
Host notices remain in `tools/gams-release-notices/`. First launch requires
network access to install the pinned Project Units into ignored `gams_modules/`.
The download does not remove macOS quarantine or bypass Gatekeeper.

Expect `plugin.font 0.1.0 (scaffold)` in the View. Errors appear in red and are
rethrown to the Host console. Rebuild and reopen the Project after plugin edits;
the component is not hot-reloaded. `make check-project` validates configuration
and JS syntax without launching GAMS. The local Project, smoke View and Host
are development-only and are excluded from the plugin ZIP.

## Documentation

```sh
make serve-docs                     # http://localhost:8080
make serve-docs DOCS_PORT=8081       # independent documentation port
make validate-docs
make build-docs                     # build/site/
```

These commands use `justgook/wiki` pinned to `v1.4.0`; downloaded engine and
rendered output stay in ignored `build/`. Enable GitHub Actions as the Pages
source to deploy documentation from the repository's default branch.

## Release

```sh
make release RELEASE_TAG=v0.1.0
```

This validates and packages locally; it does not publish. The tag must exactly
match `v` plus the semantic version in `version.txt`. CI runs `make ci` for
pushes and pull requests, and `make release RELEASE_TAG=…` for tag pushes.
Matching `v*` tags publish these GitHub Release assets:

- `plugin.font.wasm` — direct component download.
- `plugin.font-0.1.0.zip` — component, LICENSE, NOTICE, README.md,
  `wit/package.wit` and third-party `LICENSES/` texts.
- `SHA256SUMS` — SHA-256 digests for the WASM and ZIP, not itself.

The ZIP has fixed timestamps, permissions and entry order, and includes no
source or build intermediates. Publication uses the automatic GitHub token;
there are no manual digest variables or required release branch. Existing
releases are not overwritten. Review changes and prepare the matching version
commit and tag before pushing a release tag.

## License

Apache-2.0; see LICENSE and NOTICE. Preserve the third-party runtime and binding
license texts under `LICENSES/` when redistributing the component.
