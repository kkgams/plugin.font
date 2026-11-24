/*!
 * Adapted from the original web/font-renderer-core.js distance-field shaders.
 * MIT License — Copyright (c) 2020 - 2025 Viktor Chlumsky
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export function invariant(condition, message) {
    if (!condition) throw new Error(message)
}

export function codepoints(text) {
    const result = [...new Set(Array.from(text, (char) => char.codePointAt(0)))]
    if (result.some((code) => code >= 0xd800 && code <= 0xdfff)) {
        throw new RangeError("Characters must be Unicode scalars, not unpaired surrogates")
    }
    return result
}

function finite(value, name) {
    invariant(typeof value === "number" && Number.isFinite(value), `${name} must be finite`)
    return value
}

export function validateFont(info, pixels, metadata) {
    const { width, height } = info.dimensions
    invariant(
        Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0,
        "Invalid atlas dimensions",
    )
    const channels = { r8: 1, rgb8: 3, rgba8: 4 }[info["pixel-format"]]
    invariant(channels !== undefined, "Unsupported atlas pixel format")
    invariant(["sdf", "psdf", "msdf", "mtsdf"].includes(info["atlas-type"]), "Invalid atlas type")
    invariant(
        pixels instanceof Uint8Array && pixels.length === width * height * channels,
        "Atlas pixel length does not match dimensions",
    )
    invariant(
        finite(info.size, "Atlas size") > 0 && finite(info["distance-range"], "Distance range") > 0,
        "Invalid atlas scale",
    )
    invariant(
        metadata.atlas.width === width && metadata.atlas.height === height,
        "Metadata dimensions disagree with atlas",
    )
    invariant(
        metadata.atlas.size === info.size && metadata.atlas.distanceRange === info["distance-range"],
        "Metadata scale disagrees with atlas",
    )
    invariant(metadata.atlas.type === info["atlas-type"], "Metadata type disagrees with atlas")
    invariant(["top", "bottom"].includes(metadata.atlas.yOrigin), "Invalid metadata Y origin")
    invariant(Array.isArray(metadata.glyphs) && Array.isArray(metadata.kerning), "Invalid glyph or kerning metadata")
    invariant(finite(metadata.metrics.lineHeight, "Line height") > 0, "Invalid line height")
    buildGlyphMap(metadata)
    for (const pair of metadata.kerning) {
        invariant(isScalar(pair.unicode1) && isScalar(pair.unicode2), "Invalid kerning Unicode")
        finite(pair.advance, "Kerning advance")
    }
    return { info, pixels, metadata, channels }
}

// Texture storage stays bottom-up. Only ImageData/PNG needs top-down rows.
export function atlasRgba(font, mode = "rgb", topDown = true) {
    invariant(["rgb", "alpha", "median"].includes(mode), "Invalid atlas channel mode")
    const { width, height } = font.info.dimensions
    const out = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const src = ((topDown ? height - 1 - y : y) * width + x) * font.channels
            const dst = (y * width + x) * 4
            const r = font.pixels[src]
            const g = font.channels === 1 ? r : font.pixels[src + 1]
            const b = font.channels === 1 ? r : font.pixels[src + 2]
            const a = font.channels === 4 ? font.pixels[src + 3] : 255
            const v = mode === "alpha" ? a : Math.max(Math.min(r, g), Math.min(Math.max(r, g), b))
            out.set(mode === "rgb" ? [r, g, b, a] : [v, v, v, 255], dst)
        }
    }
    return out
}

// Encode distance channels directly. Canvas PNG export premultiplies alpha and
// loses MSDF RGB values wherever the MTSDF alpha channel is zero.
function pngChunk(type, payload) {
    const out = new Uint8Array(payload.length + 12)
    new DataView(out.buffer).setUint32(0, payload.length)
    out.set(new TextEncoder().encode(type), 4)
    out.set(payload, 8)
    let crc = 0xffffffff
    for (let index = 4; index < out.length - 4; index++) {
        crc ^= out[index]
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    new DataView(out.buffer).setUint32(out.length - 4, (crc ^ 0xffffffff) >>> 0)
    return out
}

export async function atlasPng(font) {
    invariant(typeof CompressionStream === "function", "PNG export requires CompressionStream")
    const { width, height } = font.info.dimensions
    const rgba = atlasRgba(font)
    const rows = new Uint8Array((width * 4 + 1) * height)
    for (let y = 0; y < height; y++)
        rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
    const compressed = new Uint8Array(
        await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer(),
    )
    const header = new Uint8Array(13)
    const view = new DataView(header.buffer)
    view.setUint32(0, width)
    view.setUint32(4, height)
    header[8] = 8 // bits per channel
    header[9] = 6 // RGBA, no gamma conversion
    const chunks = [
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", compressed),
        pngChunk("IEND", new Uint8Array()),
    ]
    const output = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        output.set(chunk, offset)
        offset += chunk.length
    }
    return output
}

function isScalar(code) {
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
}

export function buildGlyphMap(metadata) {
    const { width, height, yOrigin } = metadata.atlas
    const map = new Map()
    for (const glyph of metadata.glyphs) {
        invariant(isScalar(glyph.unicode) && !map.has(glyph.unicode), "Invalid or duplicate glyph Unicode")
        invariant(
            Object.hasOwn(glyph, "planeBounds") === Object.hasOwn(glyph, "atlasBounds"),
            "Glyph bounds must be paired",
        )
        finite(glyph.advance, "Glyph advance")
        const result = { advance: glyph.advance, empty: !Object.hasOwn(glyph, "planeBounds") }
        if (!result.empty) {
            const p = glyph.planeBounds
            const a = glyph.atlasBounds
            for (const name of ["left", "bottom", "right", "top"]) {
                finite(p[name], `Plane ${name}`)
                finite(a[name], `Atlas ${name}`)
            }
            result.plane = p
            const bottom = yOrigin === "top" ? height - a.bottom : a.bottom
            const top = yOrigin === "top" ? height - a.top : a.top
            result.uv = [a.left / width, bottom / height, (a.right - a.left) / width, (top - bottom) / height]
        }
        map.set(glyph.unicode, result)
    }
    return map
}

export function layoutText(metadata, text, size, width) {
    invariant(Number.isFinite(size) && size > 0 && Number.isFinite(width) && width > 0, "Invalid preview dimensions")
    const glyphs = buildGlyphMap(metadata)
    const kerning = new Map(
        metadata.kerning.map((pair) => [`${pair.unicode1}:${pair.unicode2}`, finite(pair.advance, "Kerning advance")]),
    )
    const quads = []
    let x = 16
    let baseline = size + 16
    let previous = null
    for (const char of text) {
        if (char === "\n") {
            x = 16
            baseline += metadata.metrics.lineHeight * size
            previous = null
            continue
        }
        const code = char.codePointAt(0)
        const glyph = glyphs.get(code)
        if (!glyph) {
            previous = null
            continue
        }
        const key = `${previous}:${code}`
        if (kerning.has(key)) x += kerning.get(key) * size
        if (x + glyph.advance * size > width - 16 && x > 16) {
            x = 16
            baseline += metadata.metrics.lineHeight * size
        }
        if (!glyph.empty) {
            const p = glyph.plane
            quads.push({
                x: x + ((p.left + p.right) * size) / 2,
                y: baseline - ((p.top + p.bottom) * size) / 2,
                width: (p.right - p.left) * size,
                height: (p.top - p.bottom) * size,
                uv: glyph.uv,
            })
        }
        x += glyph.advance * size
        previous = code
    }
    return quads
}

const vertexSource = `#version 300 es
precision highp float;
layout(location=0) in vec2 aP;
uniform vec2 uResolution;
uniform vec4 uRect;
uniform vec4 uUV;
out vec2 uv;
void main() {
    vec2 unit = aP * 0.5 + 0.5;
    uv = uUV.xy + vec2(unit.x, 1.0-unit.y) * uUV.zw;
    vec2 pos = aP * uRect.zw * 0.5 + uRect.xy;
    gl_Position = vec4((pos / uResolution * 2.0 - 1.0) * vec2(1.0,-1.0), 0.0, 1.0);
}`

// Median RGB preserves sharp MSDF corners; MTSDF alpha supplies true distance
// for effects. SDF/PSDF is replicated from R into RGB before texture upload.
const fragmentSource = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D uImg;
uniform float uRange;
uniform vec2 uAtlasSize;
uniform int uEffect;
uniform int uView;
out vec4 fragColor;
float median(float r,float g,float b) { return max(min(r,g),min(max(r,g),b)); }
void main() {
    vec4 tex = texture(uImg, uv);
    if (uView > 0) {
        float value = uView == 2 ? tex.a : median(tex.r,tex.g,tex.b);
        fragColor = uView == 1 ? vec4(tex.rgb,1.0) : vec4(vec3(value),1.0);
        return;
    }
    float sd = median(tex.r,tex.g,tex.b)-0.5;
    vec2 unitRange = vec2(uRange) / uAtlasSize;
    vec2 screenTexSize = vec2(1.0) / fwidth(uv);
    float screenRange = max(0.5 * dot(unitRange,screenTexSize),1.0);
    float fill = clamp(sd * screenRange + 0.5,0.0,1.0);
    float distPx = (tex.a-0.5) * uRange;
    float outline = 1.0-smoothstep(1.5,3.5,abs(distPx));
    float glow = (1.0-smoothstep(0.0,4.0,max(0.0,-distPx))) * (1.0-fill);
    float shadowDist = (texture(uImg,uv + vec2(-3.0,3.0)/uAtlasSize).a-0.5)*uRange;
    float shadow = (1.0-smoothstep(0.0,3.0,max(0.0,-shadowDist))) * (1.0-fill);
    vec3 color = vec3(0.88,0.99,0.94);
    float alpha = fill;
    if (uEffect==1) { color=mix(vec3(0.53,0.93,0.93),color,fill); alpha=max(outline,fill); }
    else if (uEffect==2) { color=mix(vec3(0.30,0.95,0.75),color,fill); alpha=max(fill,glow*0.8); }
    else if (uEffect==3) { color=mix(vec3(0.02,0.13,0.12),vec3(0.06,0.10,0.12),fill); alpha=max(fill,shadow*0.65); }
    fragColor=vec4(color,alpha);
    if (alpha<0.001) discard;
}`

function compile(gl, type, source) {
    const shader = gl.createShader(type)
    invariant(shader !== null, "Cannot allocate preview shader")
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(message)
    }
    return shader
}

export class FontRenderer {
    constructor(canvas) {
        this.canvas = canvas
        const gl = canvas.getContext("webgl2", { alpha: false, antialias: true })
        if (!gl) throw new RangeError("WebGL 2 is unavailable; font generation and file operations still work")
        this.gl = gl
        this.program = gl.createProgram()
        invariant(this.program !== null, "Cannot allocate preview program")
        const shaders = []
        try {
            shaders.push(compile(gl, gl.VERTEX_SHADER, vertexSource))
            shaders.push(compile(gl, gl.FRAGMENT_SHADER, fragmentSource))
            for (const shader of shaders) gl.attachShader(this.program, shader)
            gl.linkProgram(this.program)
            for (const shader of shaders) gl.detachShader(this.program, shader)
            invariant(gl.getProgramParameter(this.program, gl.LINK_STATUS), gl.getProgramInfoLog(this.program))
        } catch (error) {
            gl.deleteProgram(this.program)
            throw error
        } finally {
            for (const shader of shaders) gl.deleteShader(shader)
        }
        this.vao = gl.createVertexArray()
        this.buffer = gl.createBuffer()
        this.texture = gl.createTexture()
        if (this.vao === null || this.buffer === null || this.texture === null) {
            this.destroy()
            throw new Error("Cannot allocate preview resources")
        }
        gl.bindVertexArray(this.vao)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
        gl.enableVertexAttribArray(0)
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
        this.font = null
    }

    setFont(font) {
        this.font = font
        const gl = this.gl
        gl.bindTexture(gl.TEXTURE_2D, this.texture)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        const { width, height } = font.info.dimensions
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            width,
            height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            atlasRgba(font, "rgb", false),
        )
    }

    draw(text, size, effect, view, viewport) {
        const gl = this.gl
        const canvas = this.canvas
        invariant(
            Number.isInteger(viewport.width) &&
                viewport.width > 0 &&
                Number.isInteger(viewport.height) &&
                viewport.height > 0,
            "Invalid renderer viewport",
        )
        canvas.width = viewport.width
        canvas.height = viewport.height
        gl.viewport(0, 0, canvas.width, canvas.height)
        const effects = ["fill", "outline", "glow", "shadow"]
        const effectMode = effects.indexOf(effect)
        invariant(effectMode !== -1, "Invalid preview effect")
        const sampleEffect = this.font !== null && this.font.info["atlas-type"] === "mtsdf" && view === "sample"
            ? effectMode
            : 0
        // A dark drop shadow needs a light preview surface, unlike glow and outline.
        if (effects[sampleEffect] === "shadow") gl.clearColor(0.92, 0.95, 0.94, 1)
        else gl.clearColor(0.03, 0.08, 0.1, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        if (this.font === null) return
        gl.useProgram(this.program)
        gl.bindVertexArray(this.vao)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.texture)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        const uniform = (name) => gl.getUniformLocation(this.program, name)
        gl.uniform1i(uniform("uImg"), 0)
        gl.uniform2f(uniform("uResolution"), canvas.width, canvas.height)
        gl.uniform2f(uniform("uAtlasSize"), this.font.info.dimensions.width, this.font.info.dimensions.height)
        gl.uniform1f(uniform("uRange"), this.font.info["distance-range"])
        gl.uniform1i(uniform("uEffect"), sampleEffect)
        const modes = ["sample", "rgb", "alpha", "median"]
        invariant(modes.includes(view), "Invalid preview mode")
        gl.uniform1i(uniform("uView"), modes.indexOf(view))
        const { width, height } = this.font.info.dimensions
        const fit = Math.min(canvas.width / width, canvas.height / height)
        const quads =
            view === "sample"
                ? layoutText(this.font.metadata, text, size, canvas.width)
                : [
                      {
                          x: canvas.width / 2,
                          y: canvas.height / 2,
                          width: width * fit,
                          height: height * fit,
                          uv: [0, 0, 1, 1],
                      },
                  ]
        for (const quad of quads) {
            gl.uniform4f(uniform("uRect"), quad.x, quad.y, quad.width, quad.height)
            gl.uniform4fv(uniform("uUV"), quad.uv)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
    }

    destroy() {
        const gl = this.gl
        gl.deleteTexture(this.texture)
        gl.deleteBuffer(this.buffer)
        gl.deleteVertexArray(this.vao)
        gl.deleteProgram(this.program)
        this.font = null
    }
}
