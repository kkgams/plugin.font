#include "wasi-files.h"
#include "font_plugin.h"
#include <algorithm>
#include <cstring>
#include <utility>

namespace font_wasi {
namespace {
constexpr size_t max_input = 64u * 1024u * 1024u;
constexpr size_t chunk_size = 65536;
using Error = font_engine::Error;
using ErrorCode = font_engine::ErrorCode;

bool fail(Error &error, const std::string &message) {
    error = {ErrorCode::io_error, message};
    return false;
}
bool wasi_error(Error &error, const char *operation, wasi_filesystem_types_error_code_t code) {
    return fail(error, std::string(operation) + " (WASI filesystem error " + std::to_string(code) + ")");
}

struct Preopens {
    wasi_filesystem_preopens_list_tuple2_own_descriptor_string_t value{};
    Preopens() { wasi_filesystem_preopens_get_directories(&value); }
    ~Preopens() {
        // The generated list free releases strings/storage, not resource handles.
        for (size_t i = 0; i < value.len; ++i)
            wasi_filesystem_types_descriptor_drop_own(value.ptr[i].f0);
        wasi_filesystem_preopens_list_tuple2_own_descriptor_string_free(&value);
    }
    Preopens(const Preopens &) = delete;
    Preopens &operator=(const Preopens &) = delete;
};
struct Descriptor {
    wasi_filesystem_types_own_descriptor_t value{};
    bool opened = false;
    ~Descriptor() { if (opened) wasi_filesystem_types_descriptor_drop_own(value); }
    Descriptor() = default;
    Descriptor(const Descriptor &) = delete;
    Descriptor &operator=(const Descriptor &) = delete;
};
struct Chunk {
    font_plugin_tuple2_list_u8_bool_t value{};
    Chunk() = default;
    ~Chunk() { font_plugin_list_u8_free(&value.f0); }
    Chunk(const Chunk &) = delete;
    Chunk &operator=(const Chunk &) = delete;
};

bool resolve(const std::string &path, const Preopens &preopens,
             wasi_filesystem_types_borrow_descriptor_t &base,
             font_plugin_string_t &relative, Error &error) {
    if (path.empty() || path.find('\0') != std::string::npos)
        return fail(error, "Invalid font path: empty or contains NUL");
    bool absolute = path[0] == '/';
    bool found = false;
    size_t best = 0, index = 0, offset = 0;
    for (size_t i = 0; i < preopens.value.len; ++i) {
        const auto &guest = preopens.value.ptr[i].f1;
        if (guest.len == 0 || std::memchr(guest.ptr, 0, guest.len))
            return fail(error, "Invalid WASI preopen guest name");
        if (guest.len == 1 && guest.ptr[0] == '.') continue;
        if ((guest.ptr[0] == '/') != absolute) continue;
        // Ignore trailing separators for prefix matching, except the root '/'.
        size_t length = guest.len;
        while (length > 1 && guest.ptr[length - 1] == '/') --length;
        size_t candidate = 0;
        if (length == 1 && guest.ptr[0] == '/') {
            candidate = 1;
        } else {
            if (path.size() < length || std::memcmp(path.data(), guest.ptr, length) != 0)
                continue;
            if (path.size() > length && path[length] != '/') continue;
            candidate = length + (path.size() > length ? 1 : 0);
        }
        if (!found || length > best) {
            found = true; best = length; index = i; offset = candidate;
        }
    }
    // Relative Project paths are interpreted only through an explicitly granted '.'.
    // An unmatched absolute guest path must never fall back to that preopen.
    if (!found && !absolute) {
        for (size_t i = 0; i < preopens.value.len; ++i) {
            const auto &guest = preopens.value.ptr[i].f1;
            if (guest.len == 1 && guest.ptr[0] == '.') {
                found = true; index = i; offset = 0; break;
            }
        }
    }
    if (!found) return fail(error, "Font path is not under a granted WASI preopen");
    if (offset >= path.size() || path[offset] == '/')
        return fail(error, "Invalid font path relative to WASI preopen");
    // These borrows come from owned handles; they are not separately dropped.
    base = wasi_filesystem_types_borrow_descriptor(preopens.value.ptr[index].f0);
    relative.ptr = reinterpret_cast<uint8_t *>(const_cast<char *>(path.data() + offset));
    relative.len = path.size() - offset;
    return true;
}

bool open(const std::string &path, Preopens &preopens, bool writing,
          Descriptor &file, Error &error) {
    wasi_filesystem_types_borrow_descriptor_t base;
    font_plugin_string_t relative{};
    if (!resolve(path, preopens, base, relative, error)) return false;
    wasi_filesystem_types_error_code_t code = 0;
    if (!wasi_filesystem_types_method_descriptor_open_at(
            base, WASI_FILESYSTEM_TYPES_PATH_FLAGS_SYMLINK_FOLLOW, &relative,
            writing ? WASI_FILESYSTEM_TYPES_OPEN_FLAGS_CREATE | WASI_FILESYSTEM_TYPES_OPEN_FLAGS_TRUNCATE : 0,
            writing ? WASI_FILESYSTEM_TYPES_DESCRIPTOR_FLAGS_WRITE : WASI_FILESYSTEM_TYPES_DESCRIPTOR_FLAGS_READ,
            &file.value, &code))
        return wasi_error(error, "Failed to open font file", code);
    file.opened = true;
    return true;
}
}

bool read(const std::string &path, std::vector<uint8_t> &out, Error &error) {
    out.clear();
    Preopens preopens;
    Descriptor file;
    if (!open(path, preopens, false, file, error)) return false;
    const auto borrowed = wasi_filesystem_types_borrow_descriptor(file.value);
    std::vector<uint8_t> bytes;
    for (;;) {
        Chunk chunk;
        wasi_filesystem_types_error_code_t code = 0;
        // At the limit read one more byte to distinguish EOF from oversized input.
        const size_t requested = std::min(chunk_size, max_input - bytes.size() + 1);
        if (!wasi_filesystem_types_method_descriptor_read(borrowed, requested, bytes.size(), &chunk.value, &code))
            return wasi_error(error, "Failed to read font file", code);
        const auto &data = chunk.value.f0;
        if (data.len > requested) return fail(error, "WASI read returned more bytes than requested");
        if (data.len > max_input - bytes.size()) {
            error = {ErrorCode::resource_limit, "Font file exceeds 64 MiB input limit"};
            return false;
        }
        if (data.len) bytes.insert(bytes.end(), data.ptr, data.ptr + data.len);
        if (chunk.value.f1) break;
        if (!data.len) return fail(error, "WASI read made no progress before EOF");
    }
    out = std::move(bytes);
    return true;
}

bool write(const std::string &path, const std::vector<uint8_t> &bytes,
           uint64_t &count, Error &error) {
    count = 0;
    Preopens preopens;
    Descriptor file;
    if (!open(path, preopens, true, file, error)) return false;
    const auto borrowed = wasi_filesystem_types_borrow_descriptor(file.value);
    size_t offset = 0;
    while (offset < bytes.size()) {
        font_plugin_list_u8_t chunk{const_cast<uint8_t *>(bytes.data() + offset),
                                    std::min(chunk_size, bytes.size() - offset)};
        wasi_filesystem_types_filesize_t written = 0;
        wasi_filesystem_types_error_code_t code = 0;
        if (!wasi_filesystem_types_method_descriptor_write(borrowed, &chunk, offset, &written, &code))
            return wasi_error(error, "Failed to write font file", code);
        if (!written || written > chunk.len)
            return fail(error, "WASI write returned an invalid byte count");
        offset += static_cast<size_t>(written);
    }
    count = offset;
    return true;
}
}
