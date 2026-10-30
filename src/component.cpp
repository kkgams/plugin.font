#include "font_plugin.h"

#ifndef GAMS_FONT_VERSION
#error "GAMS_FONT_VERSION must be supplied by the build"
#endif

extern "C" void exports_gams_font_font_info(font_plugin_string_t *result) {
    font_plugin_string_dup(result, "plugin.font " GAMS_FONT_VERSION " (scaffold)");
}
