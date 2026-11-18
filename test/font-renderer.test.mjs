import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { inflateSync } from "node:zlib"

// Only the pure production data/layout module is loaded: no fake DOM, Host,
// Runtime, canvas or GPU implementation participates in these tests.
const source = await readFile(new URL("../views/font-renderer.js", import.meta.url), "utf8")
const { codepoints, validateFont, atlasRgba, atlasPng, buildGlyphMap, layoutText } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
)

function metadata() {
    return {
        atlas: { width: 2, height: 2, size: 48, distanceRange: 8, type: "msdf", yOrigin: "bottom" },
        metrics: { lineHeight: 1.25 },
        glyphs: [
            { unicode: 32, advance: 0.25 },
            {
                unicode: 65,
                advance: 0.6,
                planeBounds: { left: -0.1, right: 0.5, bottom: -0.2, top: 0.7 },
                atlasBounds: { left: 0, right: 1, bottom: 0, top: 2 },
            },
            {
                unicode: 86,
                advance: 0.6,
                planeBounds: { left: 0, right: 0.6, bottom: 0, top: 0.7 },
                atlasBounds: { left: 1, right: 2, bottom: 0, top: 2 },
            },
            { unicode: 0x1f600, advance: 1 },
        ],
        kerning: [{ unicode1: 65, unicode2: 86, advance: -0.1 }],
    }
}

function font(format = "rgb8", pixels = [10, 20, 30, 80, 70, 60, 90, 100, 110, 200, 190, 180]) {
    return validateFont(
        {
            dimensions: { width: 2, height: 2 },
            "pixel-format": format,
            "atlas-type": "msdf",
            size: 48,
            "distance-range": 8,
        },
        new Uint8Array(pixels),
        metadata(),
    )
}

test("characters are deduplicated Unicode scalars, including supplementary planes", () => {
    assert.deepEqual(codepoints("A😀A\n"), [65, 0x1f600, 10])
    assert.throws(() => codepoints("\ud800"), RangeError)
    assert.throws(() => codepoints("\udc00"), RangeError)
})

test("bottom-up tightly packed RGB is flipped exactly once for PNG", () => {
    assert.deepEqual([...atlasRgba(font())], [90, 100, 110, 255, 200, 190, 180, 255, 10, 20, 30, 255, 80, 70, 60, 255])
    assert.deepEqual([...atlasRgba(font(), "rgb", false)].slice(0, 4), [10, 20, 30, 255])
})

test("PNG preserves MTSDF RGB even where alpha is zero", async () => {
    const sample = font("rgba8", [17, 93, 240, 0, 100, 80, 60, 0, 1, 2, 3, 255, 4, 5, 6, 1])
    const png = await atlasPng(sample)
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    const chunks = []
    for (let offset = 8; offset < png.length; ) {
        const length = new DataView(png.buffer, png.byteOffset + offset).getUint32(0)
        const type = new TextDecoder().decode(png.subarray(offset + 4, offset + 8))
        chunks.push([type, png.subarray(offset + 8, offset + 8 + length)])
        offset += 12 + length
    }
    assert.deepEqual(
        chunks.map(([type]) => type),
        ["IHDR", "IDAT", "IEND"],
    )
    assert.equal(chunks[0][1][8], 8)
    assert.equal(chunks[0][1][9], 6)
    const rows = inflateSync(chunks[1][1])
    assert.equal(rows[0], 0)
    assert.equal(rows[9], 0)
    assert.deepEqual([...rows.subarray(1, 9), ...rows.subarray(10, 18)], [...atlasRgba(sample)])
    assert.deepEqual([...rows.subarray(10, 14)], [17, 93, 240, 0])
})

test("median and alpha display isolate their actual channels", () => {
    const rgba = font("rgba8", [1, 90, 20, 7, 1, 2, 3, 8, 4, 5, 6, 9, 7, 8, 9, 10])
    assert.deepEqual([...atlasRgba(rgba, "alpha", false)].slice(0, 8), [7, 7, 7, 255, 8, 8, 8, 255])
    assert.deepEqual([...atlasRgba(rgba, "median", false)].slice(0, 4), [20, 20, 20, 255])
    assert.deepEqual([...atlasRgba(font("r8", [1, 2, 3, 4]), "rgb", false)].slice(0, 4), [1, 1, 1, 255])
    assert.deepEqual([...atlasRgba(font(), "alpha", false)].slice(0, 4), [255, 255, 255, 255])
})

test("malformed internal atlas responses fail rather than silently recover", () => {
    assert.throws(() => font("rgb8", [1, 2, 3]), /pixel length/)
    assert.throws(() => font("bgra8"), /pixel format/)
    const valid = font()
    const wrong = metadata()
    wrong.atlas.size = 47
    assert.throws(() => validateFont(valid.info, valid.pixels, wrong), /scale disagrees/)
    const wrongOrigin = metadata()
    wrongOrigin.atlas.yOrigin = "sideways"
    assert.throws(() => validateFont(valid.info, valid.pixels, wrongOrigin), /Y origin/)
    assert.throws(() => atlasRgba(valid, "bogus"), /channel mode/)
})

test("glyph UVs honor metadata Y origin and whitespace has no quad", () => {
    const meta = metadata()
    const bottom = buildGlyphMap(meta)
    assert.deepEqual(bottom.get(65).uv, [0, 0, 0.5, 1])
    assert.equal(bottom.get(32).empty, true)
    meta.atlas.yOrigin = "top"
    meta.glyphs[1].atlasBounds = { left: 0, right: 1, bottom: 2, top: 0 }
    assert.deepEqual(buildGlyphMap(meta).get(65).uv, [0, 0, 0.5, 1])
})

test("text layout uses EM plane bounds, advances and kerning, not atlas pixel extents", () => {
    const quads = layoutText(metadata(), "AV", 100, 1000)
    assert.equal(quads.length, 2)
    assert.equal(quads[0].x, 36)
    assert.equal(quads[0].y, 91)
    assert.equal(quads[0].width, 60)
    assert.ok(Math.abs(quads[0].height - 90) < 1e-10)
    assert.equal(quads[1].x, 96)
})

test("newline, wrapping, missing glyphs and supplementary scalars preserve layout", () => {
    const multiline = layoutText(metadata(), "A\nV", 100, 1000)
    assert.equal(multiline[1].y, 206)
    const wrapped = layoutText(metadata(), "AA", 100, 140)
    assert.equal(wrapped[1].x, wrapped[0].x)
    assert.equal(wrapped[1].y - wrapped[0].y, 125)
    const spaced = layoutText(metadata(), "😀 A?V", 100, 1000)
    assert.equal(spaced.length, 2)
    assert.equal(spaced[0].x, 161)
    assert.equal(spaced[1].x, 231)
})

test("malformed glyphs and layout sizes fail loudly", () => {
    const invalid = metadata()
    invalid.glyphs[1].planeBounds.left = NaN
    assert.throws(() => buildGlyphMap(invalid), /Plane left/)
    assert.throws(() => layoutText(metadata(), "A", 0, 100), /preview dimensions/)
})
