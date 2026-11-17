import { runtime, unwrap } from "/core/runtime.js"
import { ViewCanvasBase } from "/util/view-canvas-base.js"
import { FontRenderer, atlasPng, codepoints, invariant, validateFont } from "./font-renderer.js"
import { linkedFontExport } from "./font-export.js"

class UserError extends Error {}
const exact = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"'
const ascii = Array.from({ length: 95 }, (_, index) => String.fromCodePoint(32 + index)).join("")

async function invoke(method, ...args) {
    // Expected user failures arrive as WIT results; transport/wiring failures
    // must propagate rather than being converted into recoverable UI outcomes.
    return await runtime.invoke(`font/font::${method}`, ...args)
}

async function result(method, ...args) {
    const value = await invoke(method, ...args)
    invariant(value !== null && typeof value === "object" && (Object.hasOwn(value, "ok") !== Object.hasOwn(value, "err")), `Malformed ${method} result`)
    if (Object.hasOwn(value, "err")) {
        invariant(value.err !== null && typeof value.err.code === "string" && typeof value.err.message === "string", `Malformed ${method} font error`)
        throw new UserError(`${value.err.code}: ${value.err.message}`)
    }
    return unwrap(value)
}

function download(blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    // Keep the URL alive until the browser has consumed the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export class ViewFont extends ViewCanvasBase {
    connectedCallback() {
        this.style.display = "contents"
        this.epoch = (this.epoch === undefined ? 0 : this.epoch) + 1
        this.resource = null
        this.font = null
        this.upload = null
        this.pending = null
        this.renderer = null
        this.innerHTML = `
            <canvas data-element="preview" width="640" height="320" aria-label="Font atlas and live text preview"></canvas>
            <aside><form aria-label="Font atlas editor">
                <fieldset>
                    <legend>Source</legend>
                    <label>Upload TTF, OTF or Artery font <input type="file" accept=".ttf,.otf,.arfont" data-field="upload"></label>
                    <label>Project font path <input type="text" data-field="path" placeholder="fonts/font.ttf or fonts/font.arfont" ${exact}></label>
                    <label>Generation source <select data-field="source"><option value="upload">Uploaded TTF/OTF</option><option value="path">Project TTF/OTF path</option></select></label>
                    <button type="button" data-action="open">Open project .arfont</button>
                </fieldset>
                <fieldset>
                    <legend>Generation</legend>
                    <label>Characters <textarea data-field="characters" rows="3" ${exact}></textarea></label>
                    <label>Atlas type <select data-field="type"><option>sdf</option><option>psdf</option><option selected>msdf</option><option>mtsdf</option></select></label>
                    <label>Size (px/em) <input type="number" data-field="size" min="1" step="any" value="48" required ${exact}></label>
                    <label>Distance range (total pixels) <input type="number" data-field="range" min="0.01" step="any" value="8" required ${exact}></label>
                    <label>Dimensions <select data-field="dimensions"><option value="auto">Automatic packing</option><option value="fixed">Fixed width and height</option></select></label>
                    <label>Width <input type="number" data-field="width" min="1" step="1" value="512" required ${exact}></label>
                    <label>Height <input type="number" data-field="height" min="1" step="1" value="512" required ${exact}></label>
                    <label>Edge coloring <select data-field="edge"><option value="simple">Simple</option><option value="ink-trap" selected>Ink trap</option><option value="distance">Distance</option></select></label>
                    <label>Miter limit <input type="number" data-field="miter" min="0" step="any" value="1" required ${exact}></label>
                    <button type="submit" class="accent" data-action="generate">Generate</button>
                </fieldset>
                <fieldset>
                    <legend>Preview and export</legend>
                    <label>Display <select data-field="display"><option value="rgb">Atlas RGB</option><option value="alpha">Atlas alpha</option><option value="median">Atlas median</option><option value="sample">Sample text</option></select></label>
                    <label>Live sample <textarea data-field="sample" rows="2" ${exact}>The quick brown fox jumps over the lazy dog.\n0123456789</textarea></label>
                    <label>Preview size (pixels) <input type="number" data-field="preview-size" min="1" step="any" value="56" required ${exact}></label>
                    <label>MTSDF effect <select data-field="effect"><option value="fill">Fill</option><option value="outline">Outline</option><option value="glow">Glow</option><option value="shadow">Shadow</option></select></label>
                    <label>Project save path <input type="text" data-field="save-path" value="font.arfont" ${exact}></label>
                    <button type="button" data-action="save" data-needs-font>Save project .arfont</button>
                    <button type="button" data-action="arfont" data-needs-font>Download .arfont</button>
                    <label>Atlas Project path <input type="text" data-field="atlas-path" value="fonts/font.png" ${exact}></label>
                    <button type="button" data-action="json" data-needs-font>Download linked .font.json</button>
                    <button type="button" data-action="png" data-needs-font>Download atlas PNG</button>
                </fieldset>
                <table><caption>Atlas information</caption><tbody data-element="info"></tbody></table>
            </form></aside>
            <footer><output data-element="status" aria-live="polite">Upload a font or enter a project path to begin.</output></footer>
        `
        this.field("characters").value = ascii
        this.querySelector("form").addEventListener("submit", event => { event.preventDefault(); void this.generate() })
        this.field("upload").addEventListener("change", () => { void this.loadUpload() })
        for (const action of ["open", "save", "arfont", "json", "png"]) {
            this.querySelector(`[data-action="${action}"]`).addEventListener("click", () => {
                if (action === "open") void this.open()
                else if (action === "save") void this.save()
                else void this.export(action)
            })
        }
        for (const name of ["display", "sample", "preview-size", "effect"]) {
            this.field(name).addEventListener("input", () => this.draw())
        }
        this.field("dimensions").addEventListener("change", () => this.syncControls())
        this.syncControls()
        try { this.renderer = new FontRenderer(document.createElement("canvas")) }
        catch (error) {
            if (!(error instanceof RangeError)) throw error
            this.status(error.message, "warning")
        }
        // The Host helper owns visible-canvas sizing, pan/zoom and registration.
        // WebGL renders offscreen; its backing dimensions cannot feed back into layout.
        super.connectedCallback()
        const source = this.getAttribute("data-source")
        if (source !== null && source !== "") { this.field("path").value = source; void this.open() }
    }

    field(name) {
        const field = this.querySelector(`[data-field="${name}"]`)
        invariant(field !== null, `Missing font field ${name}`)
        return field
    }

    element(name) {
        const element = this.querySelector(`[data-element="${name}"]`)
        invariant(element !== null, `Missing font element ${name}`)
        return element
    }

    status(message, intent = "info") {
        const output = this.element("status")
        output.textContent = message
        output.className = intent
    }

    syncControls() {
        const busy = this.pending !== null
        for (const button of this.querySelectorAll("button")) button.disabled = busy || (button.hasAttribute("data-needs-font") && this.resource === null)
        this.field("upload").disabled = busy
        const automatic = this.field("dimensions").value === "auto"
        this.field("width").disabled = automatic
        this.field("height").disabled = automatic
    }

    async operation(label, work) {
        if (this.pending !== null) {
            const message = "Wait for the current font operation to finish"
            this.status(message, "warning")
            return { err: message }
        }
        const epoch = ++this.epoch
        const current = () => this.isConnected && this.epoch === epoch
        this.status(`${label}…`)
        // Defer work until pending is assigned, including purely synchronous exports.
        const pending = Promise.resolve().then(() => work(current))
        this.pending = pending
        this.syncControls()
        try {
            await pending
            if (current()) {
                const preview = this.renderer === null ? "; WebGL 2 preview unavailable (downloads still work)" : ""
                this.status(`${label} complete${preview}`, this.renderer === null ? "warning" : "success")
            }
            return { ok: true }
        } catch (error) {
            if (current()) this.status(error.message, "danger")
            if (!(error instanceof UserError)) throw error
            return { err: error.message }
        } finally {
            if (current()) { this.pending = null; this.syncControls() }
        }
    }

    number(name, minimum, integer = false) {
        const value = this.field(name).valueAsNumber
        if (!Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) throw new UserError(`Invalid ${name}`)
        return value
    }

    config() {
        let points
        try { points = codepoints(this.field("characters").value) }
        catch (error) { if (!(error instanceof RangeError)) throw error; throw new UserError(error.message) }
        if (points.length === 0) throw new UserError("Enter at least one character")
        return {
            "atlas-type": this.field("type").value,
            codepoints: points,
            size: this.number("size", Number.MIN_VALUE),
            "distance-range": this.number("range", Number.MIN_VALUE),
            dimensions: this.field("dimensions").value === "auto" ? null : { width: this.number("width", 1, true), height: this.number("height", 1, true) },
            "edge-coloring": this.field("edge").value,
            "miter-limit": this.number("miter", 0),
        }
    }

    path(name) {
        const path = this.field(name).value.trim()
        if (path.length === 0) throw new UserError("Enter a project-relative path")
        return path
    }

    async loadUpload() {
        const files = this.field("upload").files
        invariant(files !== null, "File input must expose a FileList")
        if (files.length === 0) return
        const file = files[0]
        return this.operation("Read upload", async current => {
            if (!/\.(ttf|otf|arfont)$/i.test(file.name)) throw new UserError("Choose a .ttf, .otf or .arfont file")
            if (file.size > 64 * 1024 * 1024) throw new UserError("Font file exceeds the 64 MiB input limit")
            let bytes
            try { bytes = new Uint8Array(await file.arrayBuffer()) }
            catch (error) { throw new UserError(`Cannot read upload: ${error}`) }
            if (!current()) return
            if (/\.arfont$/i.test(file.name)) {
                this.upload = null
                await this.accept(await result("decode", Array.from(bytes)), current)
            } else {
                this.upload = bytes
                this.field("source").value = "upload"
            }
        })
    }

    generate() {
        return this.operation("Generate atlas", async current => {
            const config = this.config()
            let resource
            if (this.field("source").value === "path") resource = await result("generate-file", this.path("path"), config)
            else {
                if (this.upload === null) throw new UserError("Upload a TTF/OTF font first, or select project path")
                resource = await result("generate", Array.from(this.upload), config)
            }
            await this.accept(resource, current)
        })
    }

    open(input) {
        return this.operation("Open Artery font", async current => {
            if (input !== undefined) {
                const path = typeof input === "string" ? input : input.path
                invariant(typeof path === "string" && path.length > 0, "font.open requires a path")
                this.field("path").value = path
            }
            const path = this.path("path")
            if (!/\.arfont$/i.test(path)) throw new UserError("Open requires an .arfont project path; use Generate for TTF/OTF")
            await this.accept(await result("open", path), current)
            if (current()) this.setAttribute("data-source", path)
        })
    }

    async accept(resource, current) {
        invariant(resource !== null && typeof resource === "object" && typeof resource.$resource === "string" && typeof resource.id === "string", "Expected an owned font resource")
        let owned = true
        try {
            if (!current()) return
            const info = await invoke("atlas-info", resource)
            if (!current()) return
            const bytes = await invoke("atlas-pixels", resource)
            if (!current()) return
            const metadataJson = await invoke("metadata-json", resource)
            if (!current()) return
            invariant(typeof metadataJson === "string", "Expected metadata JSON string")
            invariant(Array.isArray(bytes) && bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255), "Expected atlas byte list")
            const font = validateFont(info, new Uint8Array(bytes), JSON.parse(metadataJson))
            const previous = this.resource
            if (this.renderer !== null) this.renderer.setFont(font)
            this.resource = resource
            this.font = { ...font, metadataJson }
            owned = false
            try { this.showInfo(); this.draw() }
            finally { if (previous !== null) await runtime.releaseResource(previous) }
        } finally {
            if (owned) await runtime.releaseResource(resource)
        }
    }

    save() {
        return this.operation("Save Artery font", async current => {
            if (this.resource === null) throw new UserError("Generate or open a font first")
            const path = this.path("save-path")
            if (!/\.arfont$/i.test(path)) throw new UserError("Save path must end in .arfont")
            await result("save", this.resource, path)
            if (current()) this.setAttribute("data-source", path)
        })
    }

    export(format) {
        return this.operation(`Download ${format}`, async current => {
            if (this.resource === null || this.font === null) throw new UserError("Generate or open a font first")
            if (format === "arfont") {
                const bytes = await result("encode", this.resource)
                invariant(Array.isArray(bytes), "Expected encoded Artery bytes")
                if (current()) download(new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }), "font.arfont")
            } else {
                invariant(format === "json" || format === "png", "Unknown font export format")
                let linked
                try { linked = linkedFontExport(this.font.metadata, this.field("atlas-path").value) }
                catch (error) { if (!(error instanceof RangeError)) throw error; throw new UserError(error.message) }
                if (format === "json") {
                    download(new Blob([JSON.stringify(linked.document, null, 2) + "\n"], { type: "application/json" }), linked.jsonFilename)
                } else {
                    const bytes = await atlasPng(this.font)
                    if (current()) download(new Blob([bytes], { type: "image/png" }), linked.imageFilename)
                }
            }
        })
    }

    showInfo() {
        invariant(this.font !== null, "Atlas information requires a font")
        const { info, metadata } = this.font
        const values = [
            ["Dimensions", `${info.dimensions.width} × ${info.dimensions.height}`],
            ["Format", info["pixel-format"]], ["Type", info["atlas-type"]],
            ["Size (px/em)", info.size], ["Distance range", info["distance-range"]],
            ["Glyphs", metadata.glyphs.length],
        ]
        const body = this.element("info")
        body.replaceChildren()
        for (const [name, value] of values) {
            const row = document.createElement("tr")
            const heading = document.createElement("th")
            heading.textContent = name
            const cell = document.createElement("td")
            cell.textContent = String(value)
            row.append(heading, cell)
            body.append(row)
        }
    }

    draw() {
        if (this.ctx === null || this.renderer === null || this.font === null) return
        const size = this.field("preview-size").valueAsNumber
        if (!Number.isFinite(size) || size <= 0) return // Incomplete user edit, not internal state.
        this.renderer.draw(this.field("sample").value, size, this.field("effect").value, this.field("display").value,
            { width: this.canvas.width, height: this.canvas.height })
        this.contentBounds = this.calculateContentBounds()
        super.draw()
    }

    drawContent(context) {
        context.drawImage(this.renderer.canvas, 0, 0)
    }

    calculateContentBounds() {
        return { minX: 0, minY: 0, maxX: this.canvas.width, maxY: this.canvas.height }
    }

    _onKeyDown(event) {
        if (event.target.closest("input, textarea, select, button") !== null) return
        super._onKeyDown(event)
    }

    disconnectedCallback() {
        ++this.epoch
        if (this.renderer !== null) { this.renderer.destroy(); this.renderer = null }
        const resource = this.resource
        this.resource = null
        this.font = null
        // A save/encode may still borrow the current resource. Release it only
        // after that operation settles; a new unaccepted result releases itself.
        const settled = this.pending === null ? Promise.resolve() : this.pending.then(() => {}, () => {})
        if (resource !== null) void settled.then(() => runtime.releaseResource(resource))
        super.disconnectedCallback()
    }
}

customElements.define("view-font", ViewFont)
