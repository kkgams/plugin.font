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
    const linked = linkedFontExport(metadata, "fonts/font.png")
    assert.deepEqual(linked, {
        document: { ...original, format: "gams.font", version: 1, image: "fonts/font.png" },
        imageFilename: "font.png", jsonFilename: "font.font.json",
    })
    assert.deepEqual(metadata, original)
    assert.deepEqual(JSON.parse(JSON.stringify(linked.document)).glyphs, original.glyphs)
})

test("suggested export basenames follow the Project PNG path, including nested and Unicode names", () => {
    for (const [path, png, json] of [
        ["font.png", "font.png", "font.font.json"],
        ["assets/fonts/日本語 regular.PNG", "日本語 regular.PNG", "日本語 regular.font.json"],
        ["fonts/ui.bold.png", "ui.bold.png", "ui.bold.font.json"],
    ]) {
        const linked = linkedFontExport({}, path)
        assert.equal(linked.document.image, path)
        assert.equal(linked.imageFilename, png)
        assert.equal(linked.jsonFilename, json)
    }
})

test("invalid or non-Project PNG paths are rejected before either export", () => {
    for (const path of [null, undefined, 7, "", "font.jpg", ".png", "/font.png", "//host/font.png", "../font.png", "fonts/../font.png", "./font.png", "fonts//font.png", "fonts/./font.png", "fonts\\font.png", "C:/font.png", "https://host/font.png", "font.png?raw", "font.png#atlas", " font.png", "font.png ", "fonts/\u0000font.png", "fonts/\nfont.png"]) {
        assert.throws(() => linkedFontExport({}, path), RangeError, String(path))
    }
})
