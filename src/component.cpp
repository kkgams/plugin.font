#include "font-engine.h"
#include "font_plugin.h"
#include "wasi-files.h"
#include <cstdlib>
#include <cstring>
#include <new>
#include <utility>
#ifndef GAMS_FONT_VERSION
#error "GAMS_FONT_VERSION must be supplied by the build"
#endif
struct exports_gams_font_font_font_t {
  font_engine::Font value;
};
namespace {
using Config = exports_gams_font_font_config_t;
using Own = exports_gams_font_font_own_font_t;
using Err = exports_gams_font_font_font_error_t;
using Borrow = exports_gams_font_font_borrow_font_t;
// Lifted lists/strings are owned by this export; generated glue does not free
// them.
struct OwnedBytes {
  font_plugin_list_u8_t *value;
  ~OwnedBytes() { font_plugin_list_u8_free(value); }
};
struct OwnedConfig {
  Config *value;
  ~OwnedConfig() { exports_gams_font_font_config_free(value); }
};
struct OwnedPath {
  font_plugin_string_t *value;
  ~OwnedPath() { font_plugin_string_free(value); }
};
void string_copy(const std::string &s, font_plugin_string_t *out) {
  font_plugin_string_dup_n(out, s.data(), s.size());
}
void bytes_copy(const std::vector<uint8_t> &v, font_plugin_list_u8_t *out) {
  out->len = v.size();
  out->ptr = nullptr;
  if (!v.empty()) {
    out->ptr = static_cast<uint8_t *>(malloc(v.size()));
    if (!out->ptr)
      abort();
    memcpy(out->ptr, v.data(), v.size());
  }
}
std::string path_string(const font_plugin_string_t *s) {
  return s->len ? std::string(reinterpret_cast<const char *>(s->ptr), s->len)
                : std::string();
}
std::vector<uint8_t> input(const font_plugin_list_u8_t *b) {
  return b->len ? std::vector<uint8_t>(b->ptr, b->ptr + b->len)
                : std::vector<uint8_t>();
}
font_engine::Config config(const Config *c) {
  font_engine::Config out;
  out.atlas_type = c->atlas_type;
  if (c->codepoints.len)
    out.codepoints.assign(c->codepoints.ptr,
                          c->codepoints.ptr + c->codepoints.len);
  out.size = c->size;
  out.distance_range = c->distance_range;
  out.miter_limit = c->miter_limit;
  out.edge_coloring = c->edge_coloring;
  out.fixed_dimensions = c->dimensions.is_some;
  if (out.fixed_dimensions) {
    out.width = c->dimensions.val.width;
    out.height = c->dimensions.val.height;
  }
  return out;
}
bool error(const font_engine::Error &e, Err *out) {
  out->code = static_cast<uint8_t>(e.code);
  string_copy(e.message, &out->message);
  return false;
}
bool result(bool ok, font_engine::Font &&f, const font_engine::Error &e,
            Own *out, Err *err) {
  if (!ok)
    return error(e, err);
  auto *rep = new (std::nothrow) exports_gams_font_font_font_t{std::move(f)};
  if (!rep)
    return error(
        {font_engine::ErrorCode::resource_limit, "Resource allocation failed"},
        err);
  *out = exports_gams_font_font_font_new(rep);
  return true;
}
bool limits(size_t bytes, size_t glyphs, Err *err) {
  return (bytes <= 64u * 1024u * 1024u && glyphs <= 2048) ||
         error({font_engine::ErrorCode::resource_limit,
                "Input exceeds resource limits"},
               err);
}
} // namespace
extern "C" {
void exports_gams_font_font_info(font_plugin_string_t *out) {
  string_copy("plugin.font " GAMS_FONT_VERSION " (msdf-atlas-gen WASI)", out);
}
void exports_gams_font_font_font_destructor(exports_gams_font_font_font_t *f) {
  delete f;
}
bool exports_gams_font_font_generate(font_plugin_list_u8_t *b, Config *c,
                                     Own *out, Err *err) {
  OwnedBytes bytes_owner{b};
  OwnedConfig config_owner{c};
  if (!limits(b->len, c->codepoints.len, err))
    return false;
  font_engine::Font f;
  font_engine::Error e;
  bool ok = font_engine::generate(input(b), config(c), f, e);
  return result(ok, std::move(f), e, out, err);
}
bool exports_gams_font_font_decode(font_plugin_list_u8_t *b, Own *out,
                                   Err *err) {
  OwnedBytes bytes_owner{b};
  if (!limits(b->len, 0, err))
    return false;
  font_engine::Font f;
  font_engine::Error e;
  bool ok = font_engine::decode(input(b), f, e);
  return result(ok, std::move(f), e, out, err);
}
void exports_gams_font_font_atlas_info(
    Borrow f, exports_gams_font_font_atlas_details_t *out) {
  const auto &i = f->value.info;
  out->dimensions = {i.width, i.height};
  out->pixel_format = i.channels == 1 ? 0 : i.channels == 3 ? 1 : 2;
  out->atlas_type = i.atlas_type;
  out->distance_range = i.distance_range;
  out->size = i.size;
}
void exports_gams_font_font_atlas_pixels(Borrow f, font_plugin_list_u8_t *out) {
  bytes_copy(f->value.pixels, out);
}
void exports_gams_font_font_metadata_json(Borrow f, font_plugin_string_t *out) {
  string_copy(f->value.json, out);
}
bool exports_gams_font_font_encode(Borrow f, font_plugin_list_u8_t *out,
                                   Err *err) {
  std::vector<uint8_t> b;
  font_engine::Error e;
  if (!font_engine::encode(f->value, b, e))
    return error(e, err);
  bytes_copy(b, out);
  return true;
}
bool exports_gams_font_font_generate_file(font_plugin_string_t *p, Config *c,
                                          Own *out, Err *err) {
  OwnedPath path_owner{p};
  OwnedConfig config_owner{c};
  if (!limits(0, c->codepoints.len, err))
    return false;
  std::vector<uint8_t> bytes;
  font_engine::Font f;
  font_engine::Error e;
  if (!font_wasi::read(path_string(p), bytes, e))
    return error(e, err);
  bool ok = font_engine::generate(bytes, config(c), f, e);
  return result(ok, std::move(f), e, out, err);
}
bool exports_gams_font_font_open(font_plugin_string_t *p, Own *out, Err *err) {
  OwnedPath path_owner{p};
  std::vector<uint8_t> bytes;
  font_engine::Font f;
  font_engine::Error e;
  if (!font_wasi::read(path_string(p), bytes, e))
    return error(e, err);
  bool ok = font_engine::decode(bytes, f, e);
  return result(ok, std::move(f), e, out, err);
}
bool exports_gams_font_font_save(Borrow f, font_plugin_string_t *p,
                                 uint64_t *out, Err *err) {
  OwnedPath path_owner{p};
  std::vector<uint8_t> bytes;
  font_engine::Error e;
  if (!font_engine::encode(f->value, bytes, e))
    return error(e, err);
  if (!font_wasi::write(path_string(p), bytes, *out, e))
    return error(e, err);
  return true;
}
}
