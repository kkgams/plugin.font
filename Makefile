.DEFAULT_GOAL := build
.DELETE_ON_ERROR:
PYTHON ?= python3
CURL ?= curl
NODE ?= node
GAMS_RELEASE_API ?= https://api.github.com/repos/kkgams/gams/releases/latest
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)
WIT_BINDGEN ?= wit-bindgen
WASM_TOOLS ?= wasm-tools
CMAKE ?= cmake
ESBUILD ?= esbuild
JOBS ?= 4
DOCS_PORT ?= 8080
VERSION := $(shell $(PYTHON) -c 'from pathlib import Path; print(Path("version.txt").read_text().strip())')
WIKI_VERSION := v1.4.0
WIKI_REPOSITORY := https://github.com/justgook/wiki
WIKI_MAKEFILE := build/wiki-$(WIKI_VERSION).mk
WIKI_ENGINE := $(abspath build/wiki-$(WIKI_VERSION))
BINDINGS := build/bindings
WIT_SOURCES := $(shell find wit -name '*.wit' -type f)
JCO := node_modules/.bin/jco

.PHONY: all build build-component build-view check check-project test test-backend test-view test-component test-host package ci release clean serve-docs validate-docs build-docs docs open
all: build
build: build-component build-view

build-view:
	@mkdir -p dist/views
	$(ESBUILD) views/view-font.js --bundle --format=esm --platform=browser --external:/core/* --external:/util/* --legal-comments=inline --outfile=dist/views/view-font.js

build-component: $(BINDINGS)/stamp
	@test -n "$$WASI_SDK_PATH" || { echo 'Use nix develop to provide WASI_SDK_PATH' >&2; exit 1; }
	$(CMAKE) -S . -B build/wasm -G Ninja -DCMAKE_BUILD_TYPE=Release -DGAMS_FONT_COMPONENT=ON -DCMAKE_TOOLCHAIN_FILE="$$WASI_SDK_PATH/share/cmake/wasi-sdk-p2.cmake"
	$(CMAKE) --build build/wasm --parallel $(JOBS)
	$(WASM_TOOLS) validate dist/plugin.font.wasm

$(BINDINGS)/stamp: $(WIT_SOURCES) Makefile flake.nix flake.lock
	@mkdir -p $(BINDINGS)
	$(WIT_BINDGEN) c wit --world font-plugin --out-dir $(BINDINGS)
	@touch $@

check: build check-project
	$(WASM_TOOLS) validate dist/plugin.font.wasm
	$(WASM_TOOLS) component wit dist/plugin.font.wasm > build/extracted.wit
	$(PYTHON) scripts/check-component.py

# Retain an existing app; never update it implicitly.
tools/gams.app:
	@test "$(UNAME_S)" = Darwin && test "$(UNAME_M)" = arm64 || \
		{ echo 'GAMS release download requires macOS Apple Silicon' >&2; exit 1; }
	@test ! -e tools/gams-release-notices || \
		{ echo 'tools/gams-release-notices already exists; move it aside before reinstalling GAMS' >&2; exit 1; }
	@mkdir -p tools
	@set -eu; stage=$$(mktemp -d "tools/.gams-download.XXXXXX"); \
		trap 'rm -rf "$$stage"' EXIT; \
		$(CURL) --fail --location --silent --show-error "$(GAMS_RELEASE_API)" --output "$$stage/release.json"; \
		url=$$($(PYTHON) -c 'import json, sys; release = json.load(open(sys.argv[1])); assets = [a for a in release["assets"] if a["name"].startswith("GAMS-") and a["name"].endswith("-macos-aarch64.zip")]; assert len(assets) == 1, "Expected exactly one GAMS macOS Apple Silicon ZIP asset"; print(assets[0]["browser_download_url"])' "$$stage/release.json"); \
		$(CURL) --fail --location --silent --show-error "$$url" --output "$$stage/gams.zip"; \
		unzip -q "$$stage/gams.zip" -d "$$stage/unpacked"; \
		test -f "$$stage/unpacked/GAMS.app/Contents/Info.plist"; \
		test -x "$$stage/unpacked/GAMS.app/Contents/MacOS/gams"; \
		mv "$$stage/unpacked/GAMS.app" "$$stage/GAMS.app"; \
		mv "$$stage/unpacked" tools/gams-release-notices; \
		mv "$$stage/GAMS.app" "$@"

open: build tools/gams.app
	GAMS_APP_CWD="$(CURDIR)" ./tools/gams.app/Contents/MacOS/gams

# Optional native Host integration: separate from portable CI and GUI rendering.
test-host: build tools/gams.app
	$(PYTHON) scripts/test-host.py

check-project:
	@for source in views/*.js; do $(NODE) --check "$$source" || exit $$?; done
	$(PYTHON) -m unittest discover -s test -p 'test_project.py' -v

test: test-backend test-view test-component
	$(PYTHON) -m unittest discover -s test -p 'test_*.py' -v

test-backend:
	$(CMAKE) -S . -B build/native -G Ninja -DCMAKE_BUILD_TYPE=Release -DGAMS_FONT_COMPONENT=OFF -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
	$(CMAKE) --build build/native --parallel $(JOBS)
	ctest --test-dir build/native --output-on-failure

test-view:
	$(NODE) --test test/*.test.mjs

node_modules/.package-lock.json: package.json package-lock.json
	npm ci --ignore-scripts

# Execute the actual component through jco's Node WASI implementation.
test-component: build-component node_modules/.package-lock.json
	$(JCO) transpile dist/plugin.font.wasm -o build/jco --name component --bindgen-enable-wasm-exnref
	$(NODE) --experimental-wasm-exnref test/component-runtime.mjs

package: check
	$(PYTHON) scripts/package.py

ci: check test validate-docs package

# Matching tags publish through GitHub Actions; this target only prepares bytes.
release: check test validate-docs
	@test -n "$(RELEASE_TAG)" || { echo 'RELEASE_TAG is required (for example v0.1.0)' >&2; exit 1; }
	$(PYTHON) scripts/package.py --tag "$(RELEASE_TAG)"

$(WIKI_MAKEFILE):
	@mkdir -p "$(@D)"
	@set -eu; trap 'rm -f "$@.tmp"' EXIT; \
		$(CURL) --fail --location --retry 3 "$(WIKI_REPOSITORY)/raw/$(WIKI_VERSION)/Makefile" -o "$@.tmp"; \
		mv "$@.tmp" "$@"

docs: build-docs

serve-docs validate-docs build-docs: $(WIKI_MAKEFILE)
	$(MAKE) -f "$(WIKI_MAKEFILE)" "$(patsubst %-docs,%,$@)" WIKI_REPOSITORY="$(WIKI_REPOSITORY)" WIKI_VERSION="$(WIKI_VERSION)" WIKI_ENGINE="$(WIKI_ENGINE)" WIKI_SOURCE="$(abspath docs)" WIKI_OUTPUT="$(abspath build/site)" PORT="$(DOCS_PORT)"

clean:
	rm -rf build dist
