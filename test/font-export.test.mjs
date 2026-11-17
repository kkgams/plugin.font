import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const source = await readFile(new URL("../views/font-export.js", import.meta.url), "utf8")
const { linkedFontExport } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)

test("linked JSON adds only its versioned contract and preserves raw metadata", () => {
    const metadata = {
        atlas: { type: "msdf", width: 64, height: 32, size: 48, distanceRange: 8, distanceRangeMiddle: 0, yOrigin: "bottom" },
        metrics: { emSize: 1, lineHeight: 1.25, ascender: 0.9, descender: -0.2, underlineY: -0.1, underlineThickness: 0.05 },
        glyphs: [{ unicode: 32, advance: 0.25 }, { unicode: 65, advance: 0.6, planeBounds: { left: -0.1, bottom: -0.2, right: 0.5, top: 0.7 }, atlasBounds: { left: 2.5, bottom: 3.5, right: 20.5, top: 29.5 } }],
        kerning: [{ unicode1: 65, unicode2: 65, advance: -0.1 }],
    }
    const original = structuredClone(metadata)
    const linked = linkedFontExport(metadata, "fonts/font.json")
    assert.deepEqual(linked, {
        document: { ...original, format: "gams.font", version: 1, image: "fonts/font.png" },
        imagePath: "fonts/font.png", jsonPath: "fonts/font.json",
    })
    assert.deepEqual(metadata, original)
    assert.deepEqual(JSON.parse(JSON.stringify(linked.document)).glyphs, original.glyphs)
})

test("paired PNG replaces only the JSON extension, including nested and Unicode names", () => {
    for (const [json, png] of [
        ["font.json", "font.png"],
        ["assets/fonts/日本語 regular.JSON", "assets/fonts/日本語 regular.png"],
        ["fonts/ui.bold.font.json", "fonts/ui.bold.font.png"],
    ]) {
        const linked = linkedFontExport({}, json)
        assert.equal(linked.document.image, png)
        assert.equal(linked.imagePath, png)
        assert.equal(linked.jsonPath, json)
    }
})

test("invalid or non-Project JSON paths are rejected before either file is written", () => {
    for (const path of [null, undefined, 7, "", "font.png", ".json", "/font.json", "//host/font.json", "../font.json", "fonts/../font.json", "./font.json", "fonts//font.json", "fonts/./font.json", "fonts\\font.json", "C:/font.json", "https://host/font.json", "font.json?raw", "font.json#atlas", " font.json", "font.json ", "fonts/\u0000font.json", "fonts/\nfont.json"]) {
        assert.throws(() => linkedFontExport({}, path), RangeError, String(path))
    }
})
