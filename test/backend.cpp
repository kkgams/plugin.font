#include "font-engine.h"
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iterator>
#include <limits>
using namespace font_engine;
static void require(bool value, const char *message) {
  if (!value) {
    fprintf(stderr, "FAIL: %s\n", message);
    exit(1);
  }
}
static void set32(std::vector<uint8_t> &b, size_t p, uint32_t v) {
  for (int j = 0; j < 4; ++j)
    b[p + j] = uint8_t(v >> (j * 8));
}
static uint32_t get32(const std::vector<uint8_t> &b, size_t p) {
  return uint32_t(b[p]) | uint32_t(b[p + 1]) << 8 | uint32_t(b[p + 2]) << 16 |
         uint32_t(b[p + 3]) << 24;
}
static void checksum(std::vector<uint8_t> &b) {
  uint32_t crc = 0xffffffff;
  for (size_t i = 0; i < b.size() - 4; ++i) {
    crc ^= b[i];
    for (int j = 0; j < 8; ++j)
      crc = (crc >> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  set32(b, b.size() - 4, crc);
}
int main(int argc, char **argv) {
  require(argc == 3, "usage: font-backend-test font.ttf workdir");
  std::ifstream input(argv[1], std::ios::binary);
  require(bool(input), "read fixture");
  std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(input)), {});
  Error e;
  Font f, decoded;
  Config c;
  c.codepoints = {32, 65, 86};
  for (unsigned t = 0; t < 4; ++t) {
    c.atlas_type = t;
    require(generate(bytes, c, f, e), e.message.c_str());
    require(f.info.channels == (t < 2 ? 1 : t == 2 ? 3 : 4), "channel count");
    require(f.info.size == 32 && f.info.distance_range == 4,
            "size/range semantics");
    require(f.pixels.size() ==
                size_t(f.info.width) * f.info.height * f.info.channels,
            "packed pixels");
    require(*std::max_element(f.pixels.begin(), f.pixels.end()) >
                *std::min_element(f.pixels.begin(), f.pixels.end()),
            "real distance-field pixels");
    require(f.json.find("\"unicode\":65") != std::string::npos &&
                f.json.find("\"yOrigin\":\"bottom\"") != std::string::npos,
            "metadata schema");
    std::vector<uint8_t> b;
    require(encode(f, b, e), "encode");
    require(decode(b, decoded, e), "decode");
    require(f.pixels == decoded.pixels && f.json == decoded.json,
            "lossless roundtrip");
    for (unsigned edge = 0; edge < 3; ++edge) {
      c.edge_coloring = edge;
      Font other;
      require(generate(bytes, c, other, e), "edge coloring");
    }
  }
  std::string path = std::string(argv[2]) + "/roundtrip.arfont";
  uint64_t count = 0;
  require(save(f, path, count, e) && count == f.artery.size(), "save stdio");
  require(open(path, decoded, e) && decoded.pixels == f.pixels, "open stdio");
  require(generate_file(argv[1], c, decoded, e), "generate-file stdio");
  require(!open(path + "/absent", decoded, e) && e.code == ErrorCode::io_error,
          "read failure");
  require(!save(f, path + "/absent", count, e) && e.code == ErrorCode::io_error,
          "write failure");
  require(!open(std::string("bad\0path", 8), decoded, e) &&
              e.code == ErrorCode::io_error,
          "NUL path");
  Config bad = c;
  bad.codepoints.clear();
  require(!generate(bytes, bad, decoded, e) &&
              e.code == ErrorCode::invalid_config,
          "empty charset rejected");
  bad = c;
  bad.codepoints = {0xd800};
  require(!generate(bytes, bad, decoded, e) &&
              e.code == ErrorCode::invalid_config,
          "surrogate rejected");
  bad = c;
  bad.codepoints = {0x110000};
  require(!generate(bytes, bad, decoded, e) &&
              e.code == ErrorCode::invalid_config,
          "invalid scalar rejected");
  bad = c;
  bad.codepoints = {0x10ffff};
  require(!generate(bytes, bad, decoded, e) &&
              e.code == ErrorCode::missing_glyph,
          "missing glyph rejected");
  bad = c;
  bad.size = std::numeric_limits<double>::quiet_NaN();
  require(!generate(bytes, bad, decoded, e) &&
              e.code == ErrorCode::invalid_config,
          "NaN rejected");
  bad = c;
  bad.distance_range = 0;
  require(!generate(bytes, bad, decoded, e) &&
              e.code == ErrorCode::invalid_config,
          "zero range rejected");
  bad = c;
  bad.fixed_dimensions = true;
  bad.width = 1;
  bad.height = 1;
  require(!generate(bytes, bad, decoded, e) &&
              e.code == ErrorCode::atlas_too_small,
          "fixed atlas too small");
  bad.width = 128;
  bad.height = 64;
  require(generate(bytes, bad, decoded, e) && decoded.info.width == 128 &&
              decoded.info.height == 64 && decoded.info.size == 32,
          "fixed dimensions preserve size");
  bad = c;
  bad.codepoints = {32};
  require(generate(bytes, bad, decoded, e) && decoded.info.width == 4 &&
              decoded.info.height == 4,
          "whitespace-only atlas");
  bad = c;
  bad.codepoints = {65, 65};
  require(generate(bytes, bad, decoded, e), "duplicate codepoints form a set");
  bad = c;
  bad.codepoints.assign(2049, 65);
  require(!generate(bytes, bad, decoded, e) &&
              e.code == ErrorCode::resource_limit,
          "glyph bound");
  require(!generate({}, c, decoded, e) && e.code == ErrorCode::invalid_font,
          "empty font");
  require(!generate({1, 2, 3}, c, decoded, e) &&
              e.code == ErrorCode::invalid_font,
          "bad font");
  require(!decode({}, decoded, e) && e.code == ErrorCode::invalid_artery,
          "empty Artery");
  auto b = f.artery;
  b.back() ^= 1;
  require(!decode(b, decoded, e) && e.code == ErrorCode::invalid_artery,
          "checksum rejection");
  b = f.artery;
  b.push_back(0);
  require(!decode(b, decoded, e), "trailing bytes rejected");
  for (size_t n = 0; n < f.artery.size(); n += 37) {
    b.assign(f.artery.begin(), f.artery.begin() + n);
    require(!decode(b, decoded, e), "truncation rejected");
  }
  b = f.artery;
  set32(b, 56, 2);
  require(!decode(b, decoded, e) && e.code == ErrorCode::unsupported_format,
          "multiple variants rejected");
  b = f.artery;
  set32(b, 112 + 184, 0xffffffff);
  require(!decode(b, decoded, e) && e.code == ErrorCode::resource_limit,
          "hostile glyph allocation rejected");
  size_t image = 112 + get32(f.artery, 60);
  require(image + 64 < f.artery.size(), "image header location");
  b = f.artery;
  set32(b, image + 4, 2);
  checksum(b);
  require(!decode(b, decoded, e) && e.code == ErrorCode::unsupported_format,
          "encoded image rejected");
  b = f.artery;
  set32(b, image + 32, 0);
  checksum(b);
  require(!decode(b, decoded, e) && e.code == ErrorCode::unsupported_format,
          "non-bottom-up image rejected");
  b = f.artery;
  set32(b, image + 8, 0xffffffff);
  checksum(b);
  require(!decode(b, decoded, e), "hostile image dimensions rejected");
  b = f.artery;
  set32(b, image + 60, 0xffffffff);
  require(!decode(b, decoded, e), "hostile image data allocation rejected");
  b = f.artery;
  set32(b, 64, 2);
  require(!decode(b, decoded, e) && e.code == ErrorCode::unsupported_format,
          "multiple atlases rejected");
  b = f.artery;
  set32(b, 28, 0x18);
  require(!decode(b, decoded, e) && e.code == ErrorCode::unsupported_format,
          "float64 variant rejected explicitly");
  b = f.artery;
  set32(b, 112 + 48 + 8, 1);
  checksum(b);
  require(!decode(b, decoded, e) && e.code == ErrorCode::unsupported_format,
          "overflowing pixel-per-em scale rejected");
  b = f.artery;
  set32(b, 112 + 48 + 20, 0);
  checksum(b);
  require(!decode(b, decoded, e) && e.code == ErrorCode::invalid_artery,
          "invalid line height rejected");
  b = f.artery;
  set32(b, 112 + 192 + 2 * 48, 65);
  checksum(b);
  require(!decode(b, decoded, e) && e.code == ErrorCode::invalid_artery,
          "duplicate Unicode glyph rejected");
  std::remove(path.c_str());
  puts("font backend tests passed");
  return 0;
}
