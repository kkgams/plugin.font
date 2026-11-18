#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace font_engine {
enum class ErrorCode {
  invalid_font,
  invalid_config,
  unsupported_format,
  atlas_too_small,
  missing_glyph,
  invalid_artery,
  resource_limit,
  encode_failed,
  io_error
};
struct Error {
  ErrorCode code;
  std::string message;
};
struct Config {
  unsigned atlas_type = 3;
  std::vector<uint32_t> codepoints;
  double size = 32, distance_range = 4, miter_limit = 1;
  bool fixed_dimensions = false;
  uint32_t width = 0, height = 0;
  unsigned edge_coloring = 1;
};
struct AtlasInfo {
  uint32_t width, height, channels, atlas_type;
  double distance_range, size;
};
struct Font {
  AtlasInfo info;
  std::vector<uint8_t> pixels, artery;
  std::string json;
};
bool generate(const std::vector<uint8_t> &, const Config &, Font &, Error &);
bool decode(const std::vector<uint8_t> &, Font &, Error &);
bool encode(const Font &, std::vector<uint8_t> &, Error &);
bool generate_file(const std::string &, const Config &, Font &, Error &);
bool open(const std::string &, Font &, Error &);
bool save(const Font &, const std::string &, uint64_t &, Error &);
} // namespace font_engine
