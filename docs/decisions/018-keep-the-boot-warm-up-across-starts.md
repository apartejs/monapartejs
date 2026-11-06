# ADR-018 — Keep the boot warm-up across app starts

- **Date**: 2026-11-06
- **Status**: proposed.
- **Context**: every app start reads the system message and the six tools again (1,775 tokens with the 0.4.0
  contract): the boot warm-up takes 41 s with the M5's GPU and 130 s on its CPU, and a message sent before it ends
  waits for it. On a native llama-server built from the same llama.cpp, the warm slot saved to a file and restored
  in a fresh server (`POST /slots/0?action=save|restore`) weighs 31.7 MB (the KV cache, the recurrent state and two
  context checkpoints in an appendix), restores in 8 ms, and the first message then reads 21 tokens: 1.8 s in all
  against 16.2 s cold. One trap: a restored slot has no adapter, and the first request naming the chat's clears the
  cache for a "lora change"; with the slot's adapter set back at restore, the cache holds.
- **Decision**: the vendored wllama (3.12.0-aparte-lfm3.2) gets two glue actions, `saveSlot(id)` (llama-server's
  slot file, returned as bytes) and `restoreSlot(id, file, lora)` (the file mounted beside the model, then
  restored with the adapters its cache was built with — a two-line patch of llama.cpp's restore). The boot warm-up
  is marked `persist`: on an instance that has run nothing yet, the engine restores the slot saved for its key into
  slot 0 — the slot a fresh instance's first request takes — before the warm-up's request, which then reads the few
  tokens after the last checkpoint; with nothing saved (or a file that does not restore, or a restored slot from
  which llama.cpp still read the whole prompt), the warm-up reads its prompt and the engine saves slot 0 — before
  the warm-up's `done`, so a message sent meanwhile waits in the provider's queue, where a Stop reaches it. The
  saved file is read into memory before the restore (an OPFS File is a snapshot another tab's save invalidates, and
  a read failing inside wllama's restore leaves its worker unusable). The file lives in OPFS through wllama's
  CacheManager, one per device, keyed on what shapes the cache: the base, the chat adapter, the device, the
  messages and tools, the context and slot sizes, and the wllama build. Only the chat adapter counts: the set's
  other adapters run at scale 0, which llama.cpp leaves out of the graph, so downloading an expert keeps the saved
  slot.
- **Consequences**: an app start no longer re-reads the contract once it has been read on that device; a new
  contract, adapter, base or wllama build is a new key, read once and saved again (the older file of the same device
  is dropped). ~32 MB more in OPFS per device. A save or restore that fails costs the start its speed, never the
  turn. `check-build` fails on a wllama without the slot actions. The fork's patches are in
  `aparte-repetitions/lab/2026-10-lfm3-bench/wllama-spike/` (`*-aparte-lfm3.2.patch`).
- **Evidence**: `aparte-repetitions/lab/2026-10-lfm3-bench/kv_persist.sh` (native, written up in
  `m5-prompt-cache-2026-11-05.md`); the app on the M5, headless Chromium on one profile, three app starts, a first
  message sent 7.5 s after each page load (drive3.mjs `persist`, c0.9):

  | first word of the first message, after sending it | start 1 | start 2 | start 3 |
  |---|---|---|---|
  | GPU, without (perf/engine-prompt-cache before this) | 41.4 s | 38.5 s | 38.7 s |
  | GPU, the warm-up kept | 39.4 s (read, then saved) | **1.4 s** | **1.4 s** |
  | CPU, the warm-up kept | 123.5 s (read, then saved) | **2.3 s** | **2.3 s** |

  The answer is the same, word for word, at every start; the saved slots take 34 MB (GPU) and 30 MB (CPU) of OPFS,
  and a restored start writes nothing.
