# Third-party legal inventory

Root `LICENSE` applies to first-party Apache-2.0 code. It does not replace the
licenses of adapted or bundled code. Preserve this directory, root `NOTICE`,
and source copyright/license headers when redistributing relevant source or
binary artifacts. The component and Views ship together in the ZIP; a direct
WASM redistributor must also provide the applicable notices and documentation.

## Font engine and renderer

| Code | Copyright / terms | License text |
| --- | --- | --- |
| msdf-atlas-gen and adapted backend code; original web renderer | 2020–2025 Viktor Chlumsky; MIT | `msdf-atlas-gen-MIT.txt` |
| msdfgen | 2014–2025 Viktor Chlumsky; MIT | `msdfgen-MIT.txt` |
| artery-font-format | 2020–2024 Viktor Chlumsky; MIT | `artery-font-format-MIT.txt` |
| FreeType 2.14.1, except separately licensed contributions | FreeType authors/contributors; FTL selected | `freetype/FTL.TXT`, `freetype/LICENSE.TXT` |

This software is based in part on the work of the FreeType Team.

Portions of this software are copyright © 2025 The FreeType Project (www.freetype.org). All rights reserved.

FreeType is used under the **FreeType License**, not the alternative GPL.
`freetype/GPLv2.TXT` is retained as the upstream alternative referenced by
`LICENSE.TXT`; its inclusion does not select GPL licensing for this build.
The unmodified FTL text gives its preferred credit with `https://freetype.org`;
the equivalent project attribution above is also retained in README and NOTICE.
FTL requires binary-distribution documentation to acknowledge the FreeType
Team's work and source distributions to preserve notices and describe changes.

Additional FreeType notices retained for the local source and standard modules:

- `freetype/BDF-README.txt`: BDF driver's MIT-like terms, including the
  Computing Research Labs/New Mexico State University portions.
- `freetype/PCF-README.txt`: PCF driver's MIT-like terms.
- `freetype/fthash-notice.txt`: the separate Computing Research Labs/New Mexico
  State University and Francesco Zappa Nardelli hash implementation notice,
  also applicable to `include/freetype/internal/fthash.h`.
- `freetype/zlib-notice.txt`: bundled zlib 1.3.1 copyright and license from
  `src/gzip/zlib.h`; FreeType's bundled gzip implementation uses this code.
- `freetype/HarfBuzz-derived-notices.txt`: exact notices from FreeType's
  `src/autofit/ft-hb-ft.c`, `ft-hb-decls.h`, `ft-hb-types.h` and
  `hb-script-list.h`. Keeping these source notices does not imply linking an
  external HarfBuzz library or providing text shaping.

Only FreeType's FTL-covered `src/dlg/dlgwrap.c` wrapper is present, not the
independent dlg implementation. Debug logging that requires dlg is not enabled;
no separate dlg library is shipped. Adding it would require its own license
text and inventory entry. External HarfBuzz, libpng, Brotli and bzip2 are not
build dependencies of this component.

## Build runtime and generated bindings

The existing toolchain notices are retained conservatively for code supplied by
WASI SDK 33 and wit-bindgen 0.57.1, including generated C bindings, LLVM's
compiler-rt/libc++ and wasi-libc with its constituent allocator/libc notices.
Compiler binaries themselves are development tools, not ZIP contents.

- `compiler-rt-full.txt`: LLVM/compiler-rt and libc++ licensing, including
  Apache-2.0 WITH LLVM-exception terms and embedded notices.
- `wasi-WIT-Apache-LLVM.txt`: WASI WIT definitions.
- `wit-bindgen-Apache.txt`, `wit-bindgen-MIT.txt`: binding-generator licensing.
- `wasi-libc-LICENSE.txt`, `wasi-libc-LICENSE-APACHE.txt`,
  `wasi-libc-LICENSE-APACHE-LLVM.txt`, `wasi-libc-LICENSE-MIT.txt`: wasi-libc
  umbrella and constituent licensing.
- `wasi-libc-libc-bottom-half_cloudlibc_LICENSE.txt`,
  `wasi-libc-libc-top-half_musl_COPYRIGHT.txt`,
  `wasi-libc-fts_musl-fts_COPYING.txt`: component-specific notices.
- `wasi-libc-dlmalloc-notice.txt`, `wasi-libc-emmalloc-notice.txt`,
  `wasi-emmalloc-emscripten-full.txt`: allocator/related notices.

No ownership change or relicense is implied by this inventory. Font data is
not relicensed by the engine: input fonts and generated assets may have their
own license requirements.
