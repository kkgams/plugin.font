// Linked JSON/PNG is a View export contract, not the component's raw metadata.
export function linkedFontExport(metadata, image) {
    if (typeof image !== "string" || image !== image.trim() ||
        /[\\:?#\u0000-\u001f\u007f]/.test(image) ||
        image.split("/").some(part => part === "" || part === "." || part === "..") ||
        !/\.png$/i.test(image)) {
        throw new RangeError("Atlas path must be a Project-relative PNG path without empty, . or .. segments")
    }
    const imageFilename = image.slice(image.lastIndexOf("/") + 1)
    if (imageFilename.length === 4) throw new RangeError("Atlas PNG path requires a filename stem")
    return {
        document: { ...metadata, format: "gams.font", version: 1, image },
        imageFilename,
        jsonFilename: `${imageFilename.slice(0, -4)}.font.json`,
    }
}
