import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"
import { inflateSync } from "node:zlib"

async function moduleAt(path) {
    const source = await readFile(new URL(path, import.meta.url), "utf8")
    return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)
}
const renderer = await moduleAt("../views/font-renderer.js")
const exports = await moduleAt("../views/font-export.js")
const source = await readFile(new URL("../views/view-font.js", import.meta.url), "utf8")

// Exercise the actual View operations with controlled IPC responses, not a second
// implementation. No DOM rendering is needed for this filesystem/lifecycle seam.
function setup(document) {
    const calls = []
    const files = new Map()
    let popup = { cancelled: true }
    let failure = null
    let failureMethod = null
    const runtime = {
        async call(method, options) {
            calls.push([method, options])
            return { ok: popup }
        },
        async invoke(method, ...args) {
            calls.push([method, ...args])
            if (failure !== null && (failureMethod === null || failureMethod === method)) return failure
            if (method === "fs/fs::stat") return { ok: { size: files.get(args[0]).length } }
            if (method === "fs/fs::read-file") return { ok: files.get(args[0]) }
            if (method === "fs/fs::write-file") { files.set(args[0], [...args[1]]); return { ok: null } }
            if (method === "fs/fs::rename") {
                files.set(args[1], files.get(args[0])); files.delete(args[0]); return { ok: null }
            }
            if (method === "font/font::encode") return { ok: [0, 255, 128] }
            if (["font/font::generate", "font/font::decode"].includes(method)) return { ok: { $resource: "gams:font/font", id: "res_test" } }
            throw new Error(`Unexpected method: ${method}`)
        },
    }
    const ViewFont = vm.runInNewContext(source.replace(/^import .*\n/gm, "").replace("export class ViewFont", "class ViewFont") + "\nViewFont", {
        runtime, unwrap: value => { if (Object.hasOwn(value, "err")) throw new Error(String(value.err)); return value.ok },
        ViewCanvasBase: class {}, ...renderer, ...exports, TextEncoder, crypto, RangeError,
        customElements: { define() {} }, document,
    })
    const view = new ViewFont()
    const fields = { path: { value: "fonts/source.ttf" }, "atlas-path": { value: "fonts/atlas.png" } }
    Object.assign(view, {
        epoch: 0, pending: null, savedPath: null, renderer: {}, isConnected: true, resource: { $resource: "gams:font/font", id: "res_test" },
        font: { channels: 4, info: { dimensions: { width: 1, height: 1 }, "pixel-format": "rgba8", "atlas-type": "mtsdf" }, pixels: new Uint8Array([4, 5, 6, 0]), metadata: { atlas: { width: 1 }, glyphs: [] } },
        field: name => { assert.ok(fields[name], name); return fields[name] },
        status(message, intent) { this.lastStatus = { message, intent } },
        syncControls() {}, config: () => ({ size: 48 }),
        setAttribute(name, value) { this[name] = value },
        async accept(resource, current) { if (current()) this.accepted = resource },
    })
    return { view, calls, files, fields, select(value) { popup = value }, fail(value, method = null) { failure = value; failureMethod = method } }
}

test("open and generation read Project fonts through plugin.fs", async () => {
    const { view, calls, files, select, fields } = setup()
    files.set("fonts/日本語.otf", [0, 255, 7])
    select({ selection: { path: "fonts/日本語.otf" } })
    assert.equal((await view.open()).ok, true)
    assert.equal(fields.path.value, "fonts/日本語.otf")
    assert.equal(calls[0][1].tag, "view-files")
    assert.equal(calls[0][1].props.mode, "chooser")
    await view.generate()
    assert.deepEqual([...calls.find(([method]) => method === "font/font::generate")[1]], [0, 255, 7])
    assert.equal(view.accepted.id, "res_test")
    assert.ok(!calls.some(([method]) => method === "font/font::generate-file"))
})

test("Artery open decodes filesystem bytes and save encodes then replaces via plugin.fs", async () => {
    const { view, calls, files, select } = setup()
    files.set("font.arfont", [1, 2, 3])
    await view.open({ path: "font.arfont" })
    assert.ok(calls.some(([method]) => method === "font/font::decode"))
    select({ path: "saved.arfont" })
    await view.saveAs()
    assert.equal(view.savedPath, "saved.arfont")
    assert.deepEqual(files.get("saved.arfont"), [0, 255, 128])
    assert.equal(calls.find(([method]) => method === "ui.popup.open")[1].props.mode, "saver")
    assert.equal([...files.keys()].filter(path => path.endsWith(".tmp")).length, 0)
})

test("Save updates an opened Artery file without a picker", async () => {
    const { view, files, calls } = setup()
    files.set("fonts/current.arfont", [1, 2, 3])
    await view.open("fonts/current.arfont")
    assert.equal(view.savedPath, "fonts/current.arfont")
    await view.save()
    assert.deepEqual(files.get("fonts/current.arfont"), [0, 255, 128])
    assert.ok(!calls.some(([method]) => method === "ui.popup.open"))
})

test("first Save chooses Artery and subsequent Save reuses the destination", async () => {
    const { view, files, calls, select } = setup()
    select({ path: "fonts/new.arfont" })
    await view.save()
    assert.equal(view.savedPath, "fonts/new.arfont")
    assert.equal(calls[0][1].props.filter, "*.arfont")
    assert.equal(calls[0][1].props.defaultName, "font.arfont")
    select({ cancelled: true })
    await view.save()
    assert.deepEqual(files.get("fonts/new.arfont"), [0, 255, 128])
    assert.equal(calls.filter(([method]) => method === "ui.popup.open").length, 1)
})

test("Save as changes the destination without changing the generation source", async () => {
    const { view, files, fields, calls, select } = setup()
    view.savedPath = "fonts/old.arfont"
    files.set(view.savedPath, [7])
    select({ path: "fonts/copy.arfont" })
    await view.saveAs()
    assert.equal(calls[0][1].props.defaultName, "old.arfont")
    assert.equal(view.savedPath, "fonts/copy.arfont")
    assert.equal(fields.path.value, "fonts/source.ttf")
    assert.deepEqual(files.get("fonts/old.arfont"), [7])
    assert.deepEqual(files.get("fonts/copy.arfont"), [0, 255, 128])
})

test("cancelled or failed Save as preserves the current destination", async () => {
    const { view, select, fail } = setup()
    view.savedPath = "original.arfont"
    await view.saveAs()
    assert.equal(view.savedPath, "original.arfont")
    select({ path: "bad.txt" })
    assert.ok((await view.saveAs()).err)
    assert.equal(view.savedPath, "original.arfont")
    select({ path: "copy.arfont" })
    fail({ err: "rename denied" }, "fs/fs::rename")
    assert.ok((await view.saveAs()).err)
    assert.equal(view.savedPath, "original.arfont")
})

test("opening TTF or OTF clears the Artery save destination", async () => {
    for (const extension of ["ttf", "otf"]) {
        const { view, files } = setup()
        view.savedPath = "previous.arfont"
        files.set(`source.${extension}`, [1])
        await view.open(`source.${extension}`)
        assert.equal(view.savedPath, null)
    }
})

test("PNG export writes real channel-preserving PNG and updates the linked JSON path", async () => {
    const { view, files, select, fields } = setup()
    select({ path: "assets/日本語.png" })
    await view.export("png")
    const png = Buffer.from(files.get("assets/日本語.png"))
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    const length = png.readUInt32BE(33)
    assert.equal(png.toString("ascii", 37, 41), "IDAT")
    assert.deepEqual([...inflateSync(png.subarray(41, 41 + length))], [0, 4, 5, 6, 0])
    assert.equal(fields["atlas-path"].value, "assets/日本語.png")
    select({ path: "metadata/font.font.json" })
    await view.export("json")
    const json = JSON.parse(Buffer.from(files.get("metadata/font.font.json")).toString("utf8"))
    assert.equal(json.image, "assets/日本語.png")
    assert.equal(json.format, "gams.font")
    assert.equal(json.version, 1)
    assert.deepEqual(json.glyphs, [])
})

test("cancel every picker without reads, encoding or writes", async () => {
    for (const action of [view => view.open(), view => view.save(), view => view.saveAs(), view => view.export("png"), view => view.export("json")]) {
        const { view, calls, files } = setup()
        const outcome = await action(view)
        assert.equal(outcome.cancelled, true)
        assert.equal(calls.length, 1)
        assert.equal(files.size, 0)
        assert.match(view.lastStatus.message, /cancelled/)
        assert.equal(view.pending, null)
    }
})

test("bad save extensions fail before encoding or writing", async () => {
    for (const action of [view => view.save(), view => view.saveAs(), view => view.export("png"), view => view.export("json")]) {
        const { view, calls, select } = setup()
        select({ path: "bad.txt" })
        assert.ok((await action(view)).err)
        assert.equal(calls.length, 1)
    }
})

test("filesystem failures report an error, never export success", async () => {
    const { view, select, fail } = setup()
    select({ path: "font.json" })
    fail({ err: "permission denied" })
    assert.match((await view.export("json")).err, /permission denied/)
    assert.equal(view.lastStatus.intent, "danger")
    assert.equal(view.pending, null)
})

test("failed rename preserves the previous destination and identifies temporary data", async () => {
    const { view, files, select, fail } = setup()
    files.set("font.json", [1, 2, 3])
    select({ path: "font.json" })
    fail({ err: "rename denied" }, "fs/fs::rename")
    const outcome = await view.export("json")
    assert.match(outcome.err, /temporary data remains at font\.json\..*\.tmp/)
    assert.deepEqual(files.get("font.json"), [1, 2, 3])
    assert.equal([...files.keys()].filter(path => path.endsWith(".tmp")).length, 1)
})

test("oversized input is rejected before reading it", async () => {
    const { view, calls, fail } = setup()
    fail({ ok: { size: 64 * 1024 * 1024 + 1 } }, "fs/fs::stat")
    assert.match((await view.open("huge.ttf")).err, /64 MiB/)
    assert.equal(calls.length, 1)
})

test("concurrent actions cannot open a second picker or write", async () => {
    const { view, calls } = setup()
    view.pending = Promise.resolve()
    assert.match((await view.save()).err, /Wait for the current/)
    assert.equal(calls.length, 0)
})

test("malformed IPC is an invariant failure, not silently swallowed", async () => {
    const { view, select, fail } = setup()
    select({ path: "font.json" })
    fail({ unexpected: true })
    await assert.rejects(view.export("json"), /Malformed filesystem/)
})

test("a disconnected View cannot write after a pending popup resolves", async () => {
    const { view, calls, select } = setup()
    select({ path: "font.json" })
    const pending = view.export("json")
    view.isConnected = false
    ++view.epoch
    await pending
    assert.equal(calls.length, 1)
})

// Only the DOM surface used to construct header controls; no Host/canvas emulation.
function headerElement(tag) {
    return {
        tag, dataset: {}, attributes: {}, children: [], listeners: {},
        setAttribute(name, value) { this.attributes[name] = value },
        hasAttribute(name) { return Object.hasOwn(this.attributes, name) },
        append(child) { this.children.push(child) },
        addEventListener(type, handler) { this.listeners[type] = handler },
        getBoundingClientRect() { return { x: 10, y: 20, width: 30, height: 30 } },
        querySelectorAll(selector) {
            assert.equal(selector, "button")
            return this.children.flatMap(child => child.tag === "button" ? [child] : child.querySelectorAll(selector))
        },
    }
}

test("header separates file and zoom actions with accessible icons and shared tooltips", async () => {
    const { view, calls } = setup({ createElement: headerElement })
    const activated = []
    for (const method of ["open", "save", "saveAs", "export", "zoomIn", "zoomOut", "zoomFit"]) {
        view[method] = (...args) => activated.push([method, ...args])
    }
    const header = view.createHeaderControlsElement()
    assert.deepEqual(header.children.map(group => group.dataset.element), ["file-actions", "view-actions"])
    assert.ok(header.children.every(group => group.attributes.role === "buttongroup"))
    assert.deepEqual(header.children.map(group => group.children.map(button => button.dataset.action)), [
        ["open", "save", "save-as", "json", "png"], ["zoom-in", "zoom-out", "zoom-fit"],
    ])
    for (const button of header.querySelectorAll("button")) {
        assert.equal(button.type, "button")
        assert.ok(button.attributes["aria-label"])
        assert.equal(button.children[0].attributes["aria-hidden"], "true")
        assert.ok(button.children[0].textContent)
        button.listeners.click()
        button.listeners.pointerenter()
    }
    await Promise.resolve()
    assert.deepEqual(activated, [["open"], ["save"], ["saveAs"], ["export", "json"], ["export", "png"], ["zoomIn"], ["zoomOut"], ["zoomFit"]])
    assert.equal(calls.length, 8)
    assert.ok(calls.every(([method, options]) => method === "ui.tooltip.tip" && options.content && options.anchor.kind === "aabb"))
})

test("header actions track empty, loaded and busy font states", () => {
    const { view, fields } = setup({ createElement: headerElement })
    view._headerControlsElement = view.createHeaderControlsElement()
    view.querySelectorAll = () => []
    Object.assign(fields, { dimensions: { value: "auto" }, width: {}, height: {} })
    const buttons = view._headerControlsElement.querySelectorAll("button")
    const sync = () => Object.getPrototypeOf(view).syncControls.call(view)
    view.resource = null
    sync()
    assert.deepEqual(buttons.filter(button => !button.disabled).map(button => button.dataset.action), ["open"])
    view.resource = { id: "loaded" }
    sync()
    assert.ok(buttons.every(button => !button.disabled))
    view.pending = Promise.resolve()
    sync()
    assert.ok(buttons.every(button => button.disabled))
    view.pending = null
    sync()
    assert.ok(buttons.every(button => !button.disabled))
})

test("the Project registers all Files popup dependencies from one pinned archive", async () => {
    const config = JSON.parse(await readFile(new URL("../gams.json", import.meta.url), "utf8"))
    for (const tag of ["view-files", "files-rename", "files-default"]) {
        assert.equal(config.ui.views[tag].url.$file.entry, `views/${tag}.js`)
        assert.match(config.ui.views[tag].url.$file.url, /\/v1\.0\.1\/view\.files\.zip$/)
        assert.equal(config.ui.views[tag].internal, true)
    }
})
