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
WASI_CC ?= wasm32-wasip2-clang
WASI_CXX ?= wasm32-wasip2-clang++
DOCS_PORT ?= 8080
VERSION := $(shell $(PYTHON) -c 'from pathlib import Path; print(Path("version.txt").read_text().strip())')
WIKI_VERSION := v1.4.0
WIKI_REPOSITORY := https://github.com/justgook/wiki
WIKI_MAKEFILE := build/wiki-$(WIKI_VERSION).mk
WIKI_ENGINE := $(abspath build/wiki-$(WIKI_VERSION))
BINDINGS := build/bindings
CFLAGS := -O2 -Wall -Wextra -Werror
CXXFLAGS := $(CFLAGS) -std=c++17 -fno-exceptions -fno-rtti

.PHONY: all build check check-project test package ci release clean serve-docs validate-docs build-docs run run-app
all: build
build: dist/plugin.font.wasm

$(BINDINGS)/stamp: wit/package.wit Makefile flake.nix flake.lock
	@mkdir -p $(BINDINGS)
	$(WIT_BINDGEN) c wit --world font-plugin --out-dir $(BINDINGS)
	@touch $@

build/bindings.o: $(BINDINGS)/stamp
	$(WASI_CC) $(CFLAGS) -I$(BINDINGS) -c $(BINDINGS)/font_plugin.c -o $@

build/component.o: src/component.cpp $(BINDINGS)/stamp version.txt
	$(WASI_CXX) $(CXXFLAGS) -I$(BINDINGS) -DGAMS_FONT_VERSION='"$(VERSION)"' -c $< -o $@

dist/plugin.font.wasm: build/component.o build/bindings.o $(BINDINGS)/stamp
	@mkdir -p dist
	$(WASI_CXX) -mexec-model=reactor -Wl,--strip-all build/component.o build/bindings.o $(BINDINGS)/font_plugin_component_type.o -o $@
	$(WASM_TOOLS) validate $@

check: build check-project
	$(WASM_TOOLS) validate dist/plugin.font.wasm
	$(WASM_TOOLS) component wit dist/plugin.font.wasm > build/extracted.wit
	$(PYTHON) scripts/check-component.py

# Use the downloaded release Host; no neighboring checkout is required.
run: run-app

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

run-app: build tools/gams.app
	GAMS_APP_CWD="$(CURDIR)" ./tools/gams.app/Contents/MacOS/gams

check-project:
	$(NODE) --input-type=module --check < dev/view-font-smoke.js
	$(PYTHON) -m unittest discover -s test -p 'test_project.py' -v

# Package and Project tests do not launch the Host or generate fonts.
test:
	$(PYTHON) -m unittest discover -s test -p 'test_*.py' -v

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

serve-docs validate-docs build-docs: $(WIKI_MAKEFILE)
	$(MAKE) -f "$(WIKI_MAKEFILE)" "$(patsubst %-docs,%,$@)" WIKI_REPOSITORY="$(WIKI_REPOSITORY)" WIKI_VERSION="$(WIKI_VERSION)" WIKI_ENGINE="$(WIKI_ENGINE)" WIKI_SOURCE="$(abspath docs)" WIKI_OUTPUT="$(abspath build/site)" PORT="$(DOCS_PORT)"

clean:
	rm -rf build dist
