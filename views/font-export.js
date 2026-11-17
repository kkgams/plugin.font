// Linked JSON/PNG is a View export contract, not the component's raw metadata.
export function linkedFontExport(metadata, jsonPath) {
    if (typeof jsonPath !== "string" || jsonPath !== jsonPath.trim() ||
        /[\\:?#\u0000-\u001f\u007f]/.test(jsonPath) ||
        jsonPath.split("/").some(part => part === "" || part === "." || part === "..") ||
        !/\.json$/i.test(jsonPath)) {
        throw new RangeError("Export path must be a Project-relative JSON path without empty, . or .. segments")
    }
    const filename = jsonPath.slice(jsonPath.lastIndexOf("/") + 1)
    if (filename.length === 5) throw new RangeError("Export JSON path requires a filename stem")
    const imagePath = jsonPath.slice(0, -5) + ".png"
    return {
        document: { ...metadata, format: "gams.font", version: 1, image: imagePath },
        imagePath, jsonPath,
    }
}
