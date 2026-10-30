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

    def test_layout_mounts_real_host_smoke_view(self):
        ui = self.config["ui"]
        self.assertEqual(ui["services"]["ui-layout"]["config"]["layout"], "<view-font-smoke />")
        view = ui["views"]["view-font-smoke"]
        self.assertEqual(view["url"], "dev/view-font-smoke.js")
        source = (ROOT / view["url"]).read_text()
        self.assertIn('from "/core/runtime.js"', source)
        self.assertIn('runtime.invoke("font/font::info")', source)
        self.assertIn('customElements.define("view-font-smoke", ViewFontSmoke)', source)
        self.assertNotIn("<style", source)
        self.assertNotIn("globalThis.__TAURI__", source)

    def test_launch_uses_downloaded_host_without_neighbor_checkout(self):
        makefile = (ROOT / "Makefile").read_text()
        self.assertIn("run: run-app\n", makefile)
        self.assertIn("run-app: build tools/gams.app\n", makefile)
        self.assertIn('GAMS_APP_CWD="$(CURDIR)" ./tools/gams.app/Contents/MacOS/gams', makefile)
        self.assertNotIn("GAMS_ROOT", makefile)
        self.assertNotIn("../gams", makefile)
        for document in ("README.md", "docs/index.md"):
            text = (ROOT / document).read_text()
            self.assertNotIn("GAMS_ROOT", text)
            self.assertNotIn("../gams", text)

    def test_installed_units_and_downloaded_host_are_ignored(self):
        ignored = (ROOT / ".gitignore").read_text().splitlines()
        self.assertIn("/gams_modules/", ignored)
        self.assertIn("/tools/", ignored)


if __name__ == "__main__":
    unittest.main()
