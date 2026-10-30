import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _setPreopens } from '@bytecodealliance/preview2-shim/filesystem'

// Real generated component + WASI implementation, not a mock of the font API.
const directory = mkdtempSync(join(tmpdir(), 'gams-font-component-'))
try {
    copyFileSync('test/fixtures/test-font.ttf', join(directory, 'fixture.ttf'))
    _setPreopens({ '/': directory })
    const { font } = await import('../build/jco/component.js')
    const bytes = readFileSync('test/fixtures/test-font.ttf')
    const config = {
        atlasType: 'mtsdf', codepoints: new Uint32Array([32, 65, 86]),
        size: 32, distanceRange: 4, dimensions: undefined,
        edgeColoring: 'ink-trap', miterLimit: 1,
    }
    const expectError = (operation, code) => assert.throws(operation, error => {
        assert.equal(error.payload.code, code)
        assert.equal(typeof error.payload.message, 'string')
        assert.ok(error.payload.message.length > 0)
        return true
    })
    assert.match(font.info(), /^plugin\.font \d+\.\d+\.\d+/)
    for (const [atlasType, channels, pixelFormat] of [
        ['sdf', 1, 'r8'], ['psdf', 1, 'r8'],
        ['msdf', 3, 'rgb8'], ['mtsdf', 4, 'rgba8'],
    ]) {
        const resource = font.generate(bytes, { ...config, atlasType })
        try {
            const info = font.atlasInfo(resource)
            const pixels = font.atlasPixels(resource)
            assert.equal(info.atlasType, atlasType)
            assert.equal(info.pixelFormat, pixelFormat)
            assert.equal(info.size, 32)
            assert.equal(info.distanceRange, 4)
            assert.equal(pixels.length, info.dimensions.width * info.dimensions.height * channels)
            assert.ok(pixels.some(value => value !== pixels[0]), 'real distance field, not empty pixels')
            const metadata = JSON.parse(font.metadataJson(resource))
            assert.equal(metadata.atlas.yOrigin, 'bottom')
            assert.equal(metadata.atlas.distanceRange, 4)
            assert.deepEqual(metadata.glyphs.map(glyph => glyph.unicode), [32, 65, 86])
            assert.ok(metadata.kerning.some(pair => pair.unicode1 === 65 && pair.unicode2 === 86 && pair.advance < 0))
            const encoded = font.encode(resource)
            const decoded = font.decode(encoded)
            try {
                assert.deepEqual(font.atlasInfo(decoded), info)
                assert.deepEqual(font.atlasPixels(decoded), pixels)
                assert.equal(font.metadataJson(decoded), font.metadataJson(resource))
                assert.deepEqual(font.encode(decoded), encoded)
            } finally {
                decoded[Symbol.dispose]()
            }
            assert.throws(() => font.atlasInfo(decoded), /resource|borrow|handle|disposed/i)
            const corrupt = encoded.slice()
            corrupt[corrupt.length - 1] ^= 1
            expectError(() => font.decode(corrupt), 'invalid-artery')
        } finally {
            resource[Symbol.dispose]()
        }
    }
    const fromFile = font.generateFile('/fixture.ttf', config)
    try {
        const encoded = font.encode(fromFile)
        assert.equal(font.save(fromFile, '/output.arfont'), BigInt(encoded.length))
        assert.deepEqual(new Uint8Array(readFileSync(join(directory, 'output.arfont'))), encoded)
        const opened = font.open('/output.arfont')
        try {
            assert.deepEqual(font.atlasPixels(opened), font.atlasPixels(fromFile))
        } finally {
            opened[Symbol.dispose]()
        }
        expectError(() => font.save(fromFile, '/absent/output.arfont'), 'io-error')
    } finally {
        fromFile[Symbol.dispose]()
    }
    expectError(() => font.open('/missing.arfont'), 'io-error')
    expectError(() => font.open('/../outside.arfont'), 'io-error')
    expectError(() => font.generate(new Uint8Array([1, 2, 3]), config), 'invalid-font')
    expectError(() => font.generate(bytes, { ...config, codepoints: new Uint32Array() }), 'invalid-config')
    expectError(() => font.generate(bytes, { ...config, codepoints: new Uint32Array([0xd800]) }), 'invalid-config')
    expectError(() => font.generate(bytes, { ...config, codepoints: new Uint32Array([0x10ffff]) }), 'missing-glyph')
    expectError(() => font.generate(bytes, { ...config, dimensions: { width: 1, height: 1 } }), 'atlas-too-small')
    expectError(() => font.generate(bytes, { ...config, size: NaN }), 'invalid-config')
    // Repeated calls cover lifted input ownership and resource destruction paths.
    for (let index = 0; index < 100; index++) {
        const resource = font.generate(bytes, config)
        resource[Symbol.dispose]()
        expectError(() => font.decode(new Uint8Array(64 * 1024)), 'invalid-artery')
    }
    console.log('PASS: real WASI component generation, Artery roundtrip, resource lifecycle and filesystem operations')
} finally {
    rmSync(directory, { recursive: true, force: true })
}
