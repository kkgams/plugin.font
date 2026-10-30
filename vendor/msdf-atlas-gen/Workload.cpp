// Single-threaded adaptation for the WASI component.
// Distributed under the MIT license in LICENSE.txt.
#include "Workload.h"

namespace msdf_atlas {
Workload::Workload() : chunks(0) {}
Workload::Workload(const std::function<bool(int, int)> &workerFunction, int chunks)
    : workerFunction(workerFunction), chunks(chunks) {}
bool Workload::finishSequential() {
    for (int i = 0; i < chunks; ++i)
        if (!workerFunction(i, 0))
            return false;
    return true;
}
bool Workload::finishParallel(int) { return false; }
bool Workload::finish(int threadCount) {
    if (!chunks) return true;
    if (threadCount == 1 || chunks == 1) return finishSequential();
    return false;
}
}
