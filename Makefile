.DEFAULT_GOAL := build
.DELETE_ON_ERROR:
PYTHON ?= python3
NODE ?= node
CURL ?= curl
CMAKE ?= cmake
ESBUILD ?= esbuild
WIT_BINDGEN ?= wit-bindgen
WASM_TOOLS ?= wasm-tools
JOBS ?= 4
DOCS_PORT ?= 8080
GAMS_RELEASE_API ?= https://api.github.com/repos/kkgams/gams/releases/tags/v3.2.0
UNAME_S := $(shell uname -s)
UNAME_M := $(shell uname -m)
WIKI_VERSION := v1.4.0
WIKI_REPOSITORY := https://github.com/justgook/wiki
WIKI_MAKEFILE := build.nosync/wiki-$(WIKI_VERSION).mk
WIKI_ENGINE := $(abspath build.nosync/wiki-$(WIKI_VERSION))
BINDINGS := build.nosync/bindings
WIT_SOURCES := $(shell find wit -name '*.wit' -type f | sort)
WIT_DIRS := $(shell find wit -type d)
ENGINE_SOURCES := $(shell find src vendor -type f | sort)
ENGINE_DIRS := $(shell find src vendor -type d)
LEGAL := LICENSE NOTICE $(shell find LICENSES -type f | sort)
LEGAL_DIRS := $(shell find LICENSES -type d)
export TMPDIR := $(CURDIR)/build.nosync/tmp
export CARGO_TARGET_DIR := $(CURDIR)/build.nosync/cargo-target
export PYTHONDONTWRITEBYTECODE := 1

.PHONY: build build-component build-view package check test test-backend test-view test-component test-host open clean docs serve-docs validate-docs
build: build-component build-view
build-component: build.nosync/plugin.font.wasm
build-view: build.nosync/views/view-font.js
package: build.nosync/SHA256SUMS build.nosync/plugin.font.zip

build.nosync/tmp:
	mkdir -p "$@"

$(BINDINGS)/stamp: $(WIT_SOURCES) $(WIT_DIRS) Makefile flake.nix flake.lock | build.nosync/tmp
	mkdir -p $(BINDINGS)
	$(WIT_BINDGEN) c wit --world font-plugin --out-dir $(BINDINGS)
	touch $@

build.nosync/plugin.font.wasm: $(ENGINE_SOURCES) $(ENGINE_DIRS) $(BINDINGS)/stamp CMakeLists.txt Makefile | build.nosync/tmp
	@test -n "$$WASI_SDK_PATH" || { echo 'Use nix develop for WASI_SDK_PATH' >&2; exit 1; }
	$(CMAKE) -S . -B build.nosync/wasm -G Ninja -DCMAKE_BUILD_TYPE=Release -DGAMS_FONT_COMPONENT=ON -DCMAKE_TOOLCHAIN_FILE="$$WASI_SDK_PATH/share/cmake/wasi-sdk-p2.cmake"
	$(CMAKE) --build build.nosync/wasm --parallel $(JOBS)
	$(WASM_TOOLS) validate $@

build.nosync/views/view-font.js: $(wildcard views/*.js) views Makefile | build.nosync/tmp
	mkdir -p $(@D)
	$(ESBUILD) views/view-font.js --bundle --format=esm --platform=browser --external:/core/* --external:/util/* --legal-comments=inline --outfile=$@

build.nosync/plugin.font.zip: build.nosync/plugin.font.wasm build.nosync/views/view-font.js $(WIT_SOURCES) $(WIT_DIRS) $(LEGAL) $(LEGAL_DIRS) README.md Makefile
	rm -f $@
	cd build.nosync && zip -q -X plugin.font.zip plugin.font.wasm views/view-font.js
	zip -q -X $@ README.md $(WIT_SOURCES) $(LEGAL)

build.nosync/SHA256SUMS: build.nosync/plugin.font.wasm build.nosync/plugin.font.zip
	cd build.nosync && shasum -a 256 plugin.font.wasm plugin.font.zip > SHA256SUMS

check: build
	$(WASM_TOOLS) component wit build.nosync/plugin.font.wasm > build.nosync/extracted.wit
	$(PYTHON) scripts/check-component.py
	@for source in views/*.js; do $(NODE) --input-type=module --check < "$$source" || exit $$?; done

test: test-backend test-view test-component
test-backend: | build.nosync/tmp
	$(CMAKE) -S . -B build.nosync/native -G Ninja -DCMAKE_BUILD_TYPE=Release -DGAMS_FONT_COMPONENT=OFF -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
	$(CMAKE) --build build.nosync/native --parallel $(JOBS)
	ctest --test-dir build.nosync/native --output-on-failure

test-view:
	$(NODE) --test test/*.test.mjs

build.nosync/test-component/plugin.font.wasm: $(ENGINE_SOURCES) $(ENGINE_DIRS) $(BINDINGS)/stamp CMakeLists.txt Makefile | build.nosync/tmp
	$(CMAKE) -S . -B build.nosync/test-wasm -G Ninja -DCMAKE_BUILD_TYPE=Debug -DGAMS_FONT_COMPONENT=ON -DGAMS_FONT_OUTPUT="$(CURDIR)/build.nosync/test-component" -DCMAKE_TOOLCHAIN_FILE="$$WASI_SDK_PATH/share/cmake/wasi-sdk-p2.cmake"
	$(CMAKE) --build build.nosync/test-wasm --parallel $(JOBS)

test-component: build.nosync/test-component/plugin.font.wasm
	FONT_COMPONENT_PATH="$(CURDIR)/build.nosync/test-component/plugin.font.wasm" cargo test --locked --manifest-path test/component/Cargo.toml

test-host: build tools/gams.app
	$(PYTHON) scripts/test-host.py

# Retain an existing app; never update it implicitly.
tools/gams.app:
	@test "$(UNAME_S)" = Darwin && test "$(UNAME_M)" = arm64 || \
		{ echo 'GAMS release download requires macOS Apple Silicon' >&2; exit 1; }
	@test ! -e tools/gams-release-notices || \
		{ echo 'tools/gams-release-notices already exists; move it aside before reinstalling GAMS' >&2; exit 1; }
	@mkdir -p tools build.nosync/tmp
	@set -eu; stage=$$(mktemp -d "build.nosync/tmp/gams-download.XXXXXX"); \
		trap 'rm -rf "$$stage"' EXIT; \
		$(CURL) --fail --location --silent --show-error "$(GAMS_RELEASE_API)" --output "$$stage/release.json"; \
		url=$$($(PYTHON) -c 'import json, sys; release = json.load(open(sys.argv[1])); assets = [a for a in release["assets"] if a["name"] == "GAMS-macos-aarch64.zip"]; assert len(assets) == 1, "Expected exactly one GAMS macOS Apple Silicon ZIP asset"; print(assets[0]["browser_download_url"])' "$$stage/release.json"); \
		$(CURL) --fail --location --silent --show-error "$$url" --output "$$stage/gams.zip"; \
		unzip -q "$$stage/gams.zip" -d "$$stage/unpacked"; \
		test -f "$$stage/unpacked/GAMS.app/Contents/Info.plist"; \
		test -x "$$stage/unpacked/GAMS.app/Contents/MacOS/gams"; \
		mv "$$stage/unpacked/GAMS.app" "$$stage/GAMS.app"; \
		mv "$$stage/unpacked" tools/gams-release-notices; \
		mv "$$stage/GAMS.app" "$@"; \
		printf 'plugin.font Makefile Host download\n' > tools/gams-release-notices/.gams-managed

open: build tools/gams.app
	GAMS_APP_CWD="$(CURDIR)" ./tools/gams.app/Contents/MacOS/gams

$(WIKI_MAKEFILE): | build.nosync/tmp
	$(CURL) --fail --location --retry 3 "$(WIKI_REPOSITORY)/raw/$(WIKI_VERSION)/Makefile" -o "$@.tmp"
	mv "$@.tmp" "$@"

docs serve-docs validate-docs: $(WIKI_MAKEFILE)
	$(MAKE) -f "$(WIKI_MAKEFILE)" "$(if $(filter docs,$@),build,$(patsubst %-docs,%,$@))" WIKI_REPOSITORY="$(WIKI_REPOSITORY)" WIKI_VERSION="$(WIKI_VERSION)" WIKI_ENGINE="$(WIKI_ENGINE)" WIKI_SOURCE="$(abspath docs)" WIKI_OUTPUT="$(abspath build.nosync/site)" PORT="$(DOCS_PORT)"

clean:
	$(PYTHON) scripts/clean.py
