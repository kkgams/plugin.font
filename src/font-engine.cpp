// Atlas generation and Artery serialization adapted from msdf-atlas-gen
// wasm/atlas_wasm.cpp.
#include "font-engine.h"
#include "BitmapAtlasStorage.h"
#include "Charset.h"
#include "FontGeometry.h"
#include "ImmediateAtlasGenerator.h"
#include "TightAtlasPacker.h"
#include "glyph-generators.h"
#include <artery-font/serialization.h>
#include <artery-font/std-artery-font.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <locale>
#include <sstream>
#include <unordered_set>
namespace font_engine {
namespace {
using namespace msdf_atlas;
constexpr size_t MAX_BYTES = 64u * 1024u * 1024u;
constexpr uint32_t MAX_GLYPHS = 2048, MAX_SIDE = 4096;
bool fail(Error &e, ErrorCode c, const char *m) {
  e = {c, m};
  return false;
}
bool scalar(uint32_t c) {
  return c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff);
}
template <int N> struct AtlasBytes {
  int width = 0;
  int height = 0;
  std::vector<uint8_t> data;
};

template <int N, msdf_atlas::GeneratorFunction<float, N> GEN_FN>
static bool generate_atlas_bytes(const std::vector<GlyphGeometry> &glyphs,
                                 int width, int height,
                                 const GeneratorAttributes &attribs,
                                 int thread_count, AtlasBytes<N> &out) {
  ImmediateAtlasGenerator<float, N, GEN_FN, BitmapAtlasStorage<byte, N>>
      generator(width, height);
  generator.setAttributes(attribs);
  generator.setThreadCount(thread_count);
  generator.generate(glyphs.data(), static_cast<int>(glyphs.size()));

  msdfgen::BitmapConstRef<byte, N> bitmap(generator.atlasStorage());
  const uint32_t size = static_cast<uint32_t>(bitmap.width * bitmap.height * N);
  out.width = bitmap.width;
  out.height = bitmap.height;
  out.data.resize(size);
  if (size > 0) {
    memcpy(out.data.data(), bitmap.pixels, size);
  }
  return true;
}

static const char *image_type_name(uint32_t atlas_type) {
  switch (atlas_type) {
  case 0:
    return "sdf";
  case 1:
    return "psdf";
  case 2:
    return "msdf";
  case 3:
    return "mtsdf";
  default:
    std::abort();
  }
}

static artery_font::ImageType to_artery_image_type(uint32_t atlas_type) {
  switch (atlas_type) {
  case 0:
    return artery_font::IMAGE_SDF;
  case 1:
    return artery_font::IMAGE_PSDF;
  case 2:
    return artery_font::IMAGE_MSDF;
  case 3:
    return artery_font::IMAGE_MTSDF;
  default:
    std::abort();
  }
}

static artery_font::CodepointType
to_artery_codepoint_type(msdf_atlas::GlyphIdentifierType id_type) {
  switch (id_type) {
  case msdf_atlas::GlyphIdentifierType::GLYPH_INDEX:
    return artery_font::CP_INDEXED;
  case msdf_atlas::GlyphIdentifierType::UNICODE_CODEPOINT:
    return artery_font::CP_UNICODE;
  }
  return artery_font::CP_UNSPECIFIED;
}

static int write_vector_callback(const void *src, int length, void *user_data) {
  if (!src || length < 0 || !user_data)
    return 0;
  auto *out = reinterpret_cast<std::vector<uint8_t> *>(user_data);
  const uint8_t *bytes = reinterpret_cast<const uint8_t *>(src);
  if (size_t(length) > MAX_BYTES - out->size())
    return 0;
  out->insert(out->end(), bytes, bytes + length);
  return length;
}

static bool build_artery_font_binary(const FontGeometry &font,
                                     const std::vector<uint8_t> &atlas_data,
                                     int atlas_w, int atlas_h, int channels,
                                     uint32_t atlas_type, double em_size,
                                     double px_range,
                                     std::vector<uint8_t> &out) {
  artery_font::StdArteryFont<float> arfont = {};
  arfont.metadataFormat = artery_font::METADATA_NONE;

  arfont.variants =
      artery_font::StdList<artery_font::StdArteryFont<float>::Variant>(1);
  auto &variant = arfont.variants[0] =
      artery_font::StdArteryFont<float>::Variant();

  const msdfgen::FontMetrics &metrics = font.getMetrics();
  msdf_atlas::GlyphIdentifierType id_type = font.getPreferredIdentifierType();
  variant.codepointType = to_artery_codepoint_type(id_type);
  variant.imageType = to_artery_image_type(atlas_type);

  variant.metrics.fontSize = float(em_size * metrics.emSize);
  variant.metrics.distanceRange = float(px_range);
  variant.metrics.distanceRangeMiddle = 0.f;
  variant.metrics.emSize = float(metrics.emSize);
  variant.metrics.ascender = float(metrics.ascenderY);
  variant.metrics.descender = float(metrics.descenderY);
  variant.metrics.lineHeight = float(metrics.lineHeight);
  variant.metrics.underlineY = float(metrics.underlineY);
  variant.metrics.underlineThickness = float(metrics.underlineThickness);

  const char *name = font.getName();
  if (name) {
    variant.name = artery_font::StdString(name, int(strlen(name)));
  }

  const auto &glyphs = font.getGlyphs();
  variant.glyphs =
      artery_font::StdList<artery_font::Glyph<float>>(glyphs.size());
  int gi = 0;
  for (const GlyphGeometry &glyph_geom : glyphs) {
    artery_font::Glyph<float> &glyph = variant.glyphs[gi++];
    glyph.codepoint = glyph_geom.getIdentifier(id_type);
    glyph.image = 0;

    double l, b, r, t;
    glyph_geom.getQuadPlaneBounds(l, b, r, t);
    glyph.planeBounds.l = float(l);
    glyph.planeBounds.b = float(b);
    glyph.planeBounds.r = float(r);
    glyph.planeBounds.t = float(t);

    glyph_geom.getQuadAtlasBounds(l, b, r, t);
    glyph.imageBounds.l = float(l);
    glyph.imageBounds.b = float(b);
    glyph.imageBounds.r = float(r);
    glyph.imageBounds.t = float(t);

    glyph.advance.h = float(glyph_geom.getAdvance());
    glyph.advance.v = 0.f;
  }

  std::vector<artery_font::KernPair<float>> kern_pairs;
  for (const auto &elem : font.getKerning()) {
    artery_font::KernPair<float> kern = {};
    if (id_type == msdf_atlas::GlyphIdentifierType::GLYPH_INDEX) {
      kern.codepoint1 = elem.first.first;
      kern.codepoint2 = elem.first.second;
      kern.advance.h = float(elem.second);
      kern_pairs.push_back(kern);
    } else {
      const GlyphGeometry *g1 =
          font.getGlyph(msdfgen::GlyphIndex(elem.first.first));
      const GlyphGeometry *g2 =
          font.getGlyph(msdfgen::GlyphIndex(elem.first.second));
      if (g1 && g2 && g1->getCodepoint() && g2->getCodepoint()) {
        kern.codepoint1 = g1->getCodepoint();
        kern.codepoint2 = g2->getCodepoint();
        kern.advance.h = float(elem.second);
        kern_pairs.push_back(kern);
      }
    }
  }

  variant.kernPairs = artery_font::StdList<artery_font::KernPair<float>>(
      int(kern_pairs.size()));
  for (size_t i = 0; i < kern_pairs.size(); ++i)
    variant.kernPairs[int(i)] = kern_pairs[i];
  arfont.images =
      artery_font::StdList<artery_font::StdArteryFont<float>::Image>(1);
  auto &image = arfont.images[0] = artery_font::StdArteryFont<float>::Image();
  image.width = atlas_w;
  image.height = atlas_h;
  image.channels = channels;
  image.imageType = to_artery_image_type(atlas_type);
  image.encoding = artery_font::IMAGE_RAW_BINARY;
  image.pixelFormat = artery_font::PIXEL_UNSIGNED8;
  image.rawBinaryFormat.rowLength = channels * atlas_w;
  image.rawBinaryFormat.orientation = artery_font::ORIENTATION_BOTTOM_UP;
  image.data = artery_font::StdByteArray(atlas_data.size());
  memcpy((uint8_t *)image.data, atlas_data.data(), atlas_data.size());

  out.clear();
  out.reserve(atlas_data.size() + 4096);
  return artery_font::encode<write_vector_callback>(arfont, &out);
}

// Preflight every allocation-bearing length before calling the upstream
// decoder.
struct Reader {
  const std::vector<uint8_t> &b;
  size_t pos = 0;
  bool skip(uint64_t n) {
    if (n > b.size() - pos)
      return false;
    pos += size_t(n);
    return true;
  }
  template <class T> bool get(T &v) {
    if (sizeof(T) > b.size() - pos)
      return false;
    memcpy(&v, b.data() + pos, sizeof(T));
    pos += sizeof(T);
    return true;
  }
  bool str(uint32_t n) { return !n || skip((uint64_t(n) + 4) & ~uint64_t(3)); }
};
int read_callback(void *dst, int n, void *ctx) {
  auto &r = *static_cast<Reader *>(ctx);
  if (n < 0 || size_t(n) > r.b.size() - r.pos)
    return 0;
  if (n)
    memcpy(dst, r.b.data() + r.pos, size_t(n));
  r.pos += size_t(n);
  return n;
}
using Artery = artery_font::StdArteryFont<float>;
bool preflight(const std::vector<uint8_t> &b, Error &e) {
  using namespace artery_font::internal;
  Reader r{b};
  ArteryFontHeader h{};
  FontVariantHeader<float> v{};
  ImageHeader i{};
  auto invalid = [&]() {
    return fail(e, ErrorCode::invalid_artery,
                "Malformed or truncated Artery font");
  };
  if (!r.get(h) || memcmp(h.tag, "ARTERY/FONT\0\0\0\0\0", 16) ||
      h.magicNo != 0x4d276a5c || h.version != 1)
    return invalid();
  if (h.realType != 0x14 || h.variantCount != 1 || h.imageCount != 1 ||
      h.appendixCount || h.flags)
    return fail(e, ErrorCode::unsupported_format,
                "Only one float32 variant and one atlas without appendices are "
                "supported");
  if (!r.str(h.metadataLength))
    return invalid();
  size_t start = r.pos;
  if (!r.get(v))
    return invalid();
  if (v.glyphCount > MAX_GLYPHS || v.kernPairCount > MAX_GLYPHS * MAX_GLYPHS)
    return fail(e, ErrorCode::resource_limit,
                "Artery glyph/kerning limit exceeded");
  if (!r.str(v.nameLength) || !r.str(v.metadataLength) ||
      !r.skip(uint64_t(v.glyphCount) * sizeof(artery_font::Glyph<float>)) ||
      !r.skip(uint64_t(v.kernPairCount) *
              sizeof(artery_font::KernPair<float>)) ||
      r.pos - start != h.variantsLength)
    return invalid();
  start = r.pos;
  if (!r.get(i) || !r.str(i.metadataLength) ||
      !r.skip((uint64_t(i.dataLength) + 3) & ~uint64_t(3)) ||
      r.pos - start != h.imagesLength || h.appendicesLength ||
      b.size() - r.pos != sizeof(ArteryFontFooter))
    return invalid();
  return true;
}
std::string json(const Artery &a, const AtlasInfo &info) {
  const auto &v = a.variants[0];
  const auto &m = v.metrics;
  std::ostringstream s;
  s.imbue(std::locale::classic());
  s.precision(17);
  s << "{\"atlas\":{\"type\":\"" << image_type_name(info.atlas_type)
    << "\",\"distanceRange\":" << info.distance_range
    << ",\"distanceRangeMiddle\":" << m.distanceRangeMiddle
    << ",\"size\":" << info.size << ",\"width\":" << info.width
    << ",\"height\":" << info.height
    << ",\"yOrigin\":\"bottom\"},\"metrics\":{\"emSize\":" << m.emSize
    << ",\"lineHeight\":" << m.lineHeight << ",\"ascender\":" << m.ascender
    << ",\"descender\":" << m.descender << ",\"underlineY\":" << m.underlineY
    << ",\"underlineThickness\":" << m.underlineThickness << "},\"glyphs\":[";
  for (int n = 0; n < v.glyphs.length(); ++n) {
    const auto &g = v.glyphs[n];
    if (n)
      s << ',';
    s << "{\"unicode\":" << g.codepoint << ",\"advance\":" << g.advance.h;
    auto bounds = [&](const char *name, const auto &b) {
      if (b.l || b.b || b.r || b.t)
        s << ",\"" << name << "\":{\"left\":" << b.l << ",\"bottom\":" << b.b
          << ",\"right\":" << b.r << ",\"top\":" << b.t << '}';
    };
    bounds("planeBounds", g.planeBounds);
    bounds("atlasBounds", g.imageBounds);
    s << '}';
  }
  s << "],\"kerning\":[";
  for (int n = 0; n < v.kernPairs.length(); ++n) {
    const auto &k = v.kernPairs[n];
    if (n)
      s << ',';
    s << "{\"unicode1\":" << k.codepoint1 << ",\"unicode2\":" << k.codepoint2
      << ",\"advance\":" << k.advance.h << '}';
  }
  s << "]}";
  return s.str();
}
bool read_file(const std::string &path, std::vector<uint8_t> &bytes, Error &e) {
  if (path.empty() || path.find('\0') != std::string::npos)
    return fail(e, ErrorCode::io_error, "Invalid file path");
  FILE *f = fopen(path.c_str(), "rb");
  if (!f)
    return fail(e, ErrorCode::io_error, "Cannot open file for reading");
  uint8_t buf[8192];
  size_t n;
  while ((n = fread(buf, 1, sizeof(buf), f))) {
    if (n > MAX_BYTES - bytes.size()) {
      fclose(f);
      return fail(e, ErrorCode::resource_limit, "Input file exceeds 64 MiB");
    }
    bytes.insert(bytes.end(), buf, buf + n);
  }
  bool ok = !ferror(f);
  if (fclose(f))
    ok = false;
  return ok || fail(e, ErrorCode::io_error, "Failed reading file");
}
} // namespace

bool decode(const std::vector<uint8_t> &b, Font &out, Error &e) {
  if (b.size() > MAX_BYTES)
    return fail(e, ErrorCode::resource_limit, "Input exceeds 64 MiB");
  if (!preflight(b, e))
    return false;
  Artery a{};
  Reader r{b};
  if (!artery_font::decode<read_callback>(a, &r) || r.pos != b.size())
    return fail(e, ErrorCode::invalid_artery,
                "Invalid Artery checksum or payload");
  const auto &i = a.images[0];
  const auto &v = a.variants[0];
  const auto &m = v.metrics;
  unsigned type;
  switch (i.imageType) {
  case artery_font::IMAGE_SDF:
    type = 0;
    break;
  case artery_font::IMAGE_PSDF:
    type = 1;
    break;
  case artery_font::IMAGE_MSDF:
    type = 2;
    break;
  case artery_font::IMAGE_MTSDF:
    type = 3;
    break;
  default:
    return fail(e, ErrorCode::unsupported_format, "Unsupported atlas type");
  }
  unsigned channels = type < 2 ? 1 : type == 2 ? 3 : 4;
  if (i.encoding != artery_font::IMAGE_RAW_BINARY ||
      i.pixelFormat != artery_font::PIXEL_UNSIGNED8 || i.channels != channels ||
      i.rawBinaryFormat.orientation != artery_font::ORIENTATION_BOTTOM_UP ||
      i.rawBinaryFormat.rowLength != uint64_t(i.width) * channels ||
      i.childImages || i.flags || i.textureFlags ||
      v.imageType != i.imageType ||
      v.codepointType != artery_font::CP_UNICODE || v.flags ||
      v.fallbackVariant || v.fallbackGlyph)
    return fail(e, ErrorCode::unsupported_format,
                "Unsupported atlas encoding, layout or variant");
  uint64_t count = uint64_t(i.width) * i.height * channels;
  if (!i.width || !i.height || i.width > MAX_SIDE || i.height > MAX_SIDE ||
      count > MAX_BYTES)
    return fail(e, ErrorCode::resource_limit, "Atlas dimensions exceed limits");
  if (count != uint64_t(i.data.length()))
    return fail(e, ErrorCode::invalid_artery, "Atlas byte count mismatch");
  const float metrics[] = {
      m.fontSize,   m.distanceRange,      m.emSize,
      m.ascender,   m.descender,          m.lineHeight,
      m.underlineY, m.underlineThickness, m.distanceRangeMiddle};
  for (int j = 0; j < 9; ++j)
    if (!std::isfinite(metrics[j]))
      return fail(e, ErrorCode::invalid_artery, "Non-finite metrics");
  const double size = double(m.fontSize) / double(m.emSize);
  if (m.fontSize <= 0 || m.emSize <= 0 || m.distanceRange <= 0 ||
      !std::isfinite(size) || size > 256 || m.distanceRange > 64 ||
      m.distanceRangeMiddle != 0)
    return fail(e, ErrorCode::unsupported_format,
                "Unsupported atlas scale or distance range");
  if (m.lineHeight <= 0)
    return fail(e, ErrorCode::invalid_artery, "Invalid font line height");
  std::unordered_set<uint32_t> codepoints;
  for (int j = 0; j < v.glyphs.length(); ++j) {
    const auto &g = v.glyphs[j];
    if (g.advance.v != 0)
      return fail(e, ErrorCode::unsupported_format,
                  "Vertical glyph advances are not supported");
    if (g.planeBounds.r < g.planeBounds.l || g.planeBounds.t < g.planeBounds.b)
      return fail(e, ErrorCode::invalid_artery, "Reversed glyph plane bounds");
    if (!codepoints.insert(g.codepoint).second)
      return fail(e, ErrorCode::invalid_artery, "Duplicate glyph codepoint");
    if (g.imageBounds.l < 0 || g.imageBounds.b < 0 ||
        g.imageBounds.r < g.imageBounds.l ||
        g.imageBounds.t < g.imageBounds.b || g.imageBounds.r > i.width ||
        g.imageBounds.t > i.height)
      return fail(e, ErrorCode::invalid_artery,
                  "Glyph atlas bounds exceed image");
  }
  for (int j = 0; j < v.glyphs.length(); ++j) {
    const auto &g = v.glyphs[j];
    if (!scalar(g.codepoint) || g.image)
      return fail(e, ErrorCode::unsupported_format,
                  "Invalid Unicode or image reference");
    const float p[] = {g.planeBounds.l, g.planeBounds.b, g.planeBounds.r,
                       g.planeBounds.t, g.imageBounds.l, g.imageBounds.b,
                       g.imageBounds.r, g.imageBounds.t, g.advance.h,
                       g.advance.v};
    for (int k = 0; k < 10; ++k)
      if (!std::isfinite(p[k]))
        return fail(e, ErrorCode::invalid_artery, "Non-finite glyph geometry");
  }
  std::unordered_set<uint64_t> kerning_pairs;
  for (int j = 0; j < v.kernPairs.length(); ++j) {
    const auto &k = v.kernPairs[j];
    if (!codepoints.count(k.codepoint1) || !codepoints.count(k.codepoint2) ||
        !std::isfinite(k.advance.h) || !std::isfinite(k.advance.v) ||
        !kerning_pairs.insert((uint64_t(k.codepoint1) << 32) | k.codepoint2)
             .second)
      return fail(e, ErrorCode::invalid_artery,
                  "Invalid or duplicate kerning pair");
    if (k.advance.v != 0)
      return fail(e, ErrorCode::unsupported_format,
                  "Vertical kerning is not supported");
  }
  Font result;
  result.info = {i.width, i.height, channels, type, m.distanceRange, size};
  const auto *pixels = static_cast<const uint8_t *>(i.data);
  result.pixels.assign(pixels, pixels + count);
  result.artery = b;
  result.json = json(a, result.info);
  out = std::move(result);
  return true;
}

bool generate(const std::vector<uint8_t> &bytes, const Config &c, Font &out,
              Error &e) {
  if (bytes.size() > MAX_BYTES || c.codepoints.size() > MAX_GLYPHS)
    return fail(e, ErrorCode::resource_limit,
                "Input or glyph count exceeds limits");
  if (c.atlas_type > 3 || c.edge_coloring > 2 || c.codepoints.empty() ||
      !std::isfinite(c.size) || c.size <= 0 || c.size > 256 ||
      !std::isfinite(c.distance_range) || c.distance_range <= 0 ||
      c.distance_range > 64 || !std::isfinite(c.miter_limit) ||
      c.miter_limit < 0 || c.miter_limit > 16 ||
      (c.fixed_dimensions &&
       (!c.width || !c.height || c.width > MAX_SIDE || c.height > MAX_SIDE)))
    return fail(e, ErrorCode::invalid_config, "Invalid atlas configuration");
  Charset charset;
  for (uint32_t cp : c.codepoints) {
    if (!scalar(cp))
      return fail(e, ErrorCode::invalid_config,
                  "Codepoints must be Unicode scalars");
    charset.add(cp);
  }
  if (bytes.empty())
    return fail(e, ErrorCode::invalid_font, "Empty font data");
  struct Ft {
    msdfgen::FreetypeHandle *p = msdfgen::initializeFreetype();
    ~Ft() {
      if (p)
        msdfgen::deinitializeFreetype(p);
    }
  } ft;
  if (!ft.p)
    return fail(e, ErrorCode::resource_limit, "FreeType initialization failed");
  struct Face {
    msdfgen::FontHandle *p;
    ~Face() {
      if (p)
        msdfgen::destroyFont(p);
    }
  } face{msdfgen::loadFontData(ft.p, bytes.data(), int(bytes.size()))};
  if (!face.p)
    return fail(e, ErrorCode::invalid_font,
                "Invalid or unsupported font bytes");
  std::vector<GlyphGeometry> glyphs;
  FontGeometry geometry(&glyphs);
  int loaded = geometry.loadCharset(face.p, 1, charset, false, true);
  if (loaded != int(charset.size()))
    return fail(e, ErrorCode::missing_glyph,
                "Font does not contain every requested codepoint");
  auto coloring = c.edge_coloring == 0   ? msdfgen::edgeColoringSimple
                  : c.edge_coloring == 1 ? msdfgen::edgeColoringInkTrap
                                         : msdfgen::edgeColoringByDistance;
  uint64_t total_area = 0;
  for (auto &g : glyphs) {
    // Validate dimensions in double precision before upstream float-to-int
    // conversion and signed-int rectangle area accumulation.
    if (!g.isWhitespace()) {
      auto bounds = g.getShapeBounds();
      double scale = c.size * g.getGeometryScale();
      double margin = .5 * c.distance_range / scale;
      bounds.l -= margin;
      bounds.b -= margin;
      bounds.r += margin;
      bounds.t += margin;
      if (c.miter_limit > 0)
        g.getShape().boundMiters(bounds.l, bounds.b, bounds.r, bounds.t, margin,
                                 c.miter_limit, 1);
      double w = std::ceil(scale * (bounds.r - bounds.l)) + 1;
      double h = std::ceil(scale * (bounds.t - bounds.b)) + 1;
      if (!std::isfinite(w) || !std::isfinite(h) || w < 0 || h < 0 ||
          w > MAX_SIDE || h > MAX_SIDE)
        return fail(e, ErrorCode::resource_limit,
                    "Glyph rectangle exceeds atlas limits");
      total_area += uint64_t(w) * uint64_t(h);
      if (total_area > uint64_t(MAX_SIDE) * MAX_SIDE)
        return fail(e, ErrorCode::resource_limit,
                    "Glyph rectangle area exceeds atlas limits");
    }
    g.edgeColoring(coloring, 3, 0);
  }
  TightAtlasPacker packer;
  if (c.fixed_dimensions)
    packer.setDimensions(int(c.width), int(c.height));
  else
    packer.setDimensionsConstraint(
        DimensionsConstraint::MULTIPLE_OF_FOUR_SQUARE);
  packer.setScale(c.size);
  packer.setPixelRange(c.distance_range);
  packer.setMiterLimit(c.miter_limit);
  if (packer.pack(glyphs.data(), int(glyphs.size())))
    return fail(e, ErrorCode::atlas_too_small,
                "Requested atlas cannot fit all glyphs");
  int w = 0, h = 0;
  packer.getDimensions(w, h);
  // A valid whitespace-only charset has no rectangles, but still owns an atlas.
  if (!c.fixed_dimensions && w == 0 && h == 0)
    w = h = 4;
  unsigned channels = c.atlas_type < 2 ? 1 : c.atlas_type == 2 ? 3 : 4;
  if (w <= 0 || h <= 0 || w > int(MAX_SIDE) || h > int(MAX_SIDE) ||
      uint64_t(w) * h * channels > MAX_BYTES)
    return fail(e, ErrorCode::resource_limit, "Generated atlas exceeds limits");
  GeneratorAttributes attributes;
  attributes.scanlinePass = true;
  attributes.config.overlapSupport = true;
  std::vector<uint8_t> pixels;
  if (c.atlas_type == 0) {
    AtlasBytes<1> a;
    generate_atlas_bytes<1, sdfGenerator>(glyphs, w, h, attributes, 1, a);
    pixels.swap(a.data);
  } else if (c.atlas_type == 1) {
    AtlasBytes<1> a;
    generate_atlas_bytes<1, psdfGenerator>(glyphs, w, h, attributes, 1, a);
    pixels.swap(a.data);
  } else if (c.atlas_type == 2) {
    AtlasBytes<3> a;
    generate_atlas_bytes<3, msdfGenerator>(glyphs, w, h, attributes, 1, a);
    pixels.swap(a.data);
  } else {
    AtlasBytes<4> a;
    generate_atlas_bytes<4, mtsdfGenerator>(glyphs, w, h, attributes, 1, a);
    pixels.swap(a.data);
  }
  std::vector<uint8_t> artery;
  if (!build_artery_font_binary(geometry, pixels, w, h, int(channels),
                                c.atlas_type, c.size, c.distance_range, artery))
    return fail(e, ErrorCode::encode_failed, "Artery serialization failed");
  return decode(artery, out, e);
}
bool encode(const Font &f, std::vector<uint8_t> &b, Error &e) {
  if (f.artery.empty())
    return fail(e, ErrorCode::encode_failed, "Font has no serialized atlas");
  b = f.artery;
  return true;
}
bool generate_file(const std::string &p, const Config &c, Font &f, Error &e) {
  std::vector<uint8_t> b;
  return read_file(p, b, e) && generate(b, c, f, e);
}
bool open(const std::string &p, Font &f, Error &e) {
  std::vector<uint8_t> b;
  return read_file(p, b, e) && decode(b, f, e);
}
bool save(const Font &f, const std::string &p, uint64_t &count, Error &e) {
  if (p.empty() || p.find('\0') != std::string::npos)
    return fail(e, ErrorCode::io_error, "Invalid file path");
  std::vector<uint8_t> b;
  if (!encode(f, b, e))
    return false;
  FILE *file = fopen(p.c_str(), "wb");
  if (!file)
    return fail(e, ErrorCode::io_error, "Cannot open file for writing");
  size_t n = fwrite(b.data(), 1, b.size(), file);
  bool ok = n == b.size();
  if (fclose(file))
    ok = false;
  if (!ok)
    return fail(e, ErrorCode::io_error, "Failed writing file");
  count = n;
  return true;
}
} // namespace font_engine
