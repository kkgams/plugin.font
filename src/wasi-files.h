#pragma once
#include "font-engine.h"

namespace font_wasi {
bool read(const std::string &path, std::vector<uint8_t> &out,
          font_engine::Error &error);
bool write(const std::string &path, const std::vector<uint8_t> &bytes,
           uint64_t &count, font_engine::Error &error);
} // namespace font_wasi
