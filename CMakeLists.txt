cmake_minimum_required(VERSION 3.20)
project(gams-font LANGUAGES C CXX)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
option(GAMS_FONT_COMPONENT "Build the WASI component instead of native tests" ON)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/version.txt" FONT_VERSION)
string(STRIP "${FONT_VERSION}" FONT_VERSION)

# All dependency sources are local. No find_package, FetchContent or submodules.
add_library(freetype STATIC
  vendor/freetype/src/autofit/autofit.c
  vendor/freetype/src/base/ftbase.c
  vendor/freetype/src/base/ftbbox.c
  vendor/freetype/src/base/ftbdf.c
  vendor/freetype/src/base/ftbitmap.c
  vendor/freetype/src/base/ftcid.c
  vendor/freetype/src/base/ftfstype.c
  vendor/freetype/src/base/ftgasp.c
  vendor/freetype/src/base/ftglyph.c
  vendor/freetype/src/base/ftgxval.c
  vendor/freetype/src/base/ftinit.c
  vendor/freetype/src/base/ftmm.c
  vendor/freetype/src/base/ftotval.c
  vendor/freetype/src/base/ftpatent.c
  vendor/freetype/src/base/ftpfr.c
  vendor/freetype/src/base/ftstroke.c
  vendor/freetype/src/base/ftsynth.c
  vendor/freetype/src/base/fttype1.c
  vendor/freetype/src/base/ftwinfnt.c
  vendor/freetype/src/bdf/bdf.c
  vendor/freetype/src/bzip2/ftbzip2.c
  vendor/freetype/src/cache/ftcache.c
  vendor/freetype/src/cff/cff.c
  vendor/freetype/src/cid/type1cid.c
  vendor/freetype/src/gzip/ftgzip.c
  vendor/freetype/src/lzw/ftlzw.c
  vendor/freetype/src/pcf/pcf.c
  vendor/freetype/src/pfr/pfr.c
  vendor/freetype/src/psaux/psaux.c
  vendor/freetype/src/pshinter/pshinter.c
  vendor/freetype/src/psnames/psnames.c
  vendor/freetype/src/raster/raster.c
  vendor/freetype/src/sdf/sdf.c
  vendor/freetype/src/sfnt/sfnt.c
  vendor/freetype/src/smooth/smooth.c
  vendor/freetype/src/svg/svg.c
  vendor/freetype/src/truetype/truetype.c
  vendor/freetype/src/type1/type1.c
  vendor/freetype/src/type42/type42.c
  vendor/freetype/src/winfonts/winfnt.c
  vendor/freetype/src/base/ftsystem.c
  vendor/freetype/src/base/ftdebug.c
)
target_compile_definitions(freetype PRIVATE FT2_BUILD_LIBRARY)
target_include_directories(freetype PUBLIC vendor/freetype/include)
if(CMAKE_SYSTEM_NAME STREQUAL "WASI")
  # FreeType's cmap validator uses setjmp/longjmp, backed by Wasm EH.
  target_compile_options(freetype PUBLIC
    "SHELL:-mllvm -wasm-enable-sjlj"
    "SHELL:-mllvm -wasm-use-legacy-eh=false"
  )
  target_link_libraries(freetype PUBLIC setjmp)
endif()

file(GLOB MSDF_CORE CONFIGURE_DEPENDS vendor/msdfgen/core/*.cpp)
add_library(msdf STATIC
  ${MSDF_CORE}
  vendor/msdfgen/ext/import-font.cpp
  vendor/msdfgen/ext/resolve-shape-geometry.cpp
  vendor/msdf-atlas-gen/Charset.cpp
  vendor/msdf-atlas-gen/GlyphGeometry.cpp
  vendor/msdf-atlas-gen/FontGeometry.cpp
  vendor/msdf-atlas-gen/Padding.cpp
  vendor/msdf-atlas-gen/RectanglePacker.cpp
  vendor/msdf-atlas-gen/TightAtlasPacker.cpp
  vendor/msdf-atlas-gen/Workload.cpp
  vendor/msdf-atlas-gen/bitmap-blit.cpp
  vendor/msdf-atlas-gen/glyph-generators.cpp
  vendor/msdf-atlas-gen/size-selectors.cpp
  vendor/msdf-atlas-gen/utf8.cpp
)
target_include_directories(msdf PUBLIC
  vendor vendor/msdf-atlas-gen vendor/msdfgen vendor/artery-font-format
)
target_compile_definitions(msdf PUBLIC
  MSDFGEN_DISABLE_SVG MSDFGEN_DISABLE_PNG MSDF_ATLAS_NO_ARTERY_FONT
  MSDFGEN_USE_CPP11
)
target_link_libraries(msdf PUBLIC freetype)
target_compile_options(msdf PRIVATE -fno-exceptions -fno-rtti)

add_library(font-engine STATIC src/font-engine.cpp)
target_include_directories(font-engine PUBLIC src)
target_link_libraries(font-engine PUBLIC msdf)
target_compile_options(font-engine PRIVATE -Wall -Wextra -fno-exceptions -fno-rtti)

if(GAMS_FONT_COMPONENT)
  if(NOT CMAKE_SYSTEM_NAME STREQUAL "WASI")
    message(FATAL_ERROR "Component builds require the WASI SDK Preview 2 toolchain")
  endif()
  add_executable(font-component
    src/component.cpp
    src/wasi-files.cpp
    build/bindings/font_plugin.c
    build/bindings/font_plugin_component_type.o
  )
  target_include_directories(font-component PRIVATE build/bindings)
  target_compile_definitions(font-component PRIVATE GAMS_FONT_VERSION="${FONT_VERSION}")
  target_compile_options(font-component PRIVATE -Wall -Wextra -fno-exceptions -fno-rtti)
  target_link_libraries(font-component PRIVATE font-engine)
  target_link_options(font-component PRIVATE -mexec-model=reactor -Wl,--strip-all)
  set_target_properties(font-component PROPERTIES
    OUTPUT_NAME plugin.font SUFFIX .wasm
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/dist"
  )
else()
  enable_testing()
  add_executable(font-backend-test test/backend.cpp)
  target_link_libraries(font-backend-test PRIVATE font-engine)
  target_compile_options(font-backend-test PRIVATE -Wall -Wextra -fno-exceptions -fno-rtti)
  add_test(NAME font-backend COMMAND font-backend-test
    "${CMAKE_CURRENT_SOURCE_DIR}/test/fixtures/test-font.ttf"
    "${CMAKE_CURRENT_BINARY_DIR}"
  )
endif()
