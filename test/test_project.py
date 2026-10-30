"""Local Project wiring checks; these do not replace a real Host smoke run."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / "gams.json").read_text())

    def test_project_loads_local_font_and_required_base_plugins(self):
        self.assertEqual(self.config["plugins"], [
            "https://github.com/kkgams/plugin.fs/releases/download/v0.2.0/plugin.fs.wasm",
            "https://github.com/kkgams/plugin.layout/releases/download/v0.2.0/plugin.layout.wasm",
            "dist/plugin.font.wasm",
        ])
        self.assertNotIn("sql", self.config)

    def test_bootstrap_services_and_theme_are_pinned(self):
        ui = self.config["ui"]
        self.assertEqual(ui["keys"], [])
        self.assertEqual(set(ui["services"]), {
            "ui-context", "ui-keys", "ui-layout", "ui-toast", "ui-popup", "ui-tooltip",
        })
        for unit in [ui["theme"], *ui["services"].values()]:
            self.assertRegex(unit["url"], r"^https://github\.com/kkgams/.+/releases/download/v[0-9]+\.[0-9]+\.[0-9]+/.+\.zip#.+")

    def test_layout_mounts_bundled_real_host_font_view(self):
        ui = self.config["ui"]
        self.assertEqual(ui["services"]["ui-layout"]["config"]["layout"], "<view-font />")
        view = ui["views"]["view-font"]
        self.assertEqual(view["url"], "dist/views/view-font.js")
        source = (ROOT / "views/view-font.js").read_text()
        self.assertIn('from "/core/runtime.js"', source)
        self.assertIn('from "./font-renderer.js"', source)
        self.assertIn('from "/util/view-canvas-base.js"', source)
        self.assertIn("extends ViewCanvasBase", source)
        self.assertIn('new FontRenderer(document.createElement("canvas"))', source)
        self.assertIn('runtime.invoke(`font/font::${method}`', source)
        self.assertIn('return unwrap(value)', source)
        self.assertIn('runtime.releaseResource(resource)', source)
        self.assertIn('customElements.define("view-font", ViewFont)', source)
        self.assertNotIn("<style", source)
        self.assertNotIn("globalThis.__TAURI__", source)
        self.assertNotIn("WebAssembly", source)
        for method in ("generate", "generate-file", "open", "decode", "save", "encode",
                       "atlas-info", "atlas-pixels", "metadata-json"):
            self.assertIn(f'"{method}"', source)
        self.assertTrue((ROOT / "views/font-renderer.js").is_file())
        makefile = (ROOT / "Makefile").read_text()
        self.assertIn("--bundle --format=esm --platform=browser", makefile)
        self.assertIn("--external:/core/* --external:/util/*", makefile)

    def test_launch_uses_downloaded_host_without_neighbor_checkout(self):
        makefile = (ROOT / "Makefile").read_text()
        self.assertNotRegex(makefile, r"(?m)^(?:run|run-app|play)\s*:")
        phony = next(line for line in makefile.splitlines() if line.startswith(".PHONY:"))
        self.assertTrue({"run", "run-app", "play"}.isdisjoint(phony.split()[1:]))
        self.assertIn("open: build tools/gams.app\n", makefile)
        self.assertIn('GAMS_APP_CWD="$(CURDIR)" ./tools/gams.app/Contents/MacOS/gams', makefile)
        self.assertNotIn("GAMS_ROOT", makefile)
        self.assertNotIn("../gams", makefile)
        for document in ("README.md", "docs/index.md"):
            text = (ROOT / document).read_text()
            self.assertNotIn("GAMS_ROOT", text)
            self.assertNotIn("../gams", text)

    def test_standard_docs_command_and_release_branch_publication(self):
        makefile = (ROOT / "Makefile").read_text()
        self.assertIn("docs: build-docs\n", makefile)
        self.assertIn("serve-docs validate-docs build-docs:", makefile)
        self.assertIn('WIKI_SOURCE="$(abspath docs)"', makefile)
        pages = (ROOT / ".github/workflows/pages.yml").read_text()
        self.assertIn("branches: ['release']", pages)
        self.assertIn("if: github.ref == 'refs/heads/release'", pages)
        self.assertIn("run: nix develop --command make docs", pages)
        self.assertNotIn("default_branch", pages)
        release = (ROOT / ".github/workflows/release.yml").read_text()
        self.assertIn("tags: ['v*']", release)
        self.assertIn("if: startsWith(github.ref, 'refs/tags/v')", release)
        self.assertIn('gh release create "$RELEASE_TAG" --verify-tag', release)

    def test_installed_units_and_downloaded_host_are_ignored(self):
        ignored = (ROOT / ".gitignore").read_text().splitlines()
        self.assertIn("/gams_modules/", ignored)
        self.assertIn("/tools/", ignored)


if __name__ == "__main__":
    unittest.main()
