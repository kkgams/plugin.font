import { runtime } from "/core/runtime.js"
import { registerViewPlugin, unregisterViewPlugin } from "/util/view-plugin.js"

export class ViewFontSmoke extends HTMLElement {
    connectedCallback() {
        this.style.display = "contents"
        this.innerHTML = `
            <article class="prose">
                <p>Calls the locally built font component through the real GAMS Runtime.
                This tests plugin wiring only, not font generation.</p>
                <pre data-element="result" aria-live="polite"></pre>
            </article>
            <footer>
                <button type="button" data-action="run">Call font.info()</button>
            </footer>
        `
        registerViewPlugin(this)
        this.querySelector('[data-action="run"]').addEventListener("click", () => {
            void this.run()
        })
        void this.run()
    }

    async run() {
        const output = this.querySelector('[data-element="result"]')
        const button = this.querySelector('[data-action="run"]')
        button.disabled = true
        output.textContent = "Calling font/font::info…"
        output.className = ""
        try {
            const result = await runtime.invoke("font/font::info")
            if (typeof result !== "string" || result.length === 0) {
                throw new Error("font.info() must return a non-empty build identity")
            }
            output.textContent = result
            output.className = "success"
            return result
        } catch (error) {
            output.textContent = String(error)
            output.className = "danger"
            throw error
        } finally {
            button.disabled = false
        }
    }

    disconnectedCallback() {
        void unregisterViewPlugin(this)
    }
}

customElements.define("view-font-smoke", ViewFontSmoke)
