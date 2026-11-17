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
function setup() {
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
        customElements: { define() {} },
    })
    const view = new ViewFont()
    const fields = { path: { value: "fonts/source.ttf" }, "atlas-path": { value: "fonts/atlas.png" } }
    Object.assign(view, {
        epoch: 0, pending: null, renderer: {}, isConnected: true, resource: { $resource: "gams:font/font", id: "res_test" },
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
    await view.save()
    assert.deepEqual(files.get("saved.arfont"), [0, 255, 128])
    assert.equal(calls.find(([method]) => method === "ui.popup.open")[1].props.mode, "saver")
    assert.equal([...files.keys()].filter(path => path.endsWith(".tmp")).length, 0)
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
    for (const action of [view => view.open(), view => view.save(), view => view.export("png"), view => view.export("json")]) {
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
    for (const action of [view => view.save(), view => view.export("png"), view => view.export("json")]) {
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

test("the Project registers all Files popup dependencies from one pinned archive", async () => {
    const config = JSON.parse(await readFile(new URL("../gams.json", import.meta.url), "utf8"))
    for (const tag of ["view-files", "files-rename", "files-default"]) {
        assert.equal(config.ui.views[tag].url.$file.entry, `views/${tag}.js`)
        assert.match(config.ui.views[tag].url.$file.url, /\/v1\.0\.1\/view\.files\.zip$/)
        assert.equal(config.ui.views[tag].internal, true)
    }
})
