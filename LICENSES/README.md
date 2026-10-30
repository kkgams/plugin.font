# Build runtime and binding licenses

These upstream license texts are retained conservatively for code supplied by
WASI SDK 33 and wit-bindgen 0.57.1: generated C bindings, LLVM/compiler-rt,
libc++ (covered by LLVM's Apache-2.0 WITH LLVM-exception terms), and wasi-libc
with its constituent allocator and libc notices. The texts are carried from
the workspace's existing `plugin.image` toolchain inventory, which pins the
same tool versions. No ownership change or relicense is implied.

The compiler binaries themselves are development dependencies, not ZIP contents.
The scaffold does not bundle font libraries or font assets. When integrating
msdf-atlas-gen, msdfgen, artery-font-format and FreeType, preserve their exact
upstream notices and update this inventory and the root NOTICE.
