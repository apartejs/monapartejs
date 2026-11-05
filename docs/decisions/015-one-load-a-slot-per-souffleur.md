# ADR-015 — One load for the souffleur set, a cache slot per souffleur

- **Date**: 2026-11-05
- **Status**: proposed. Supersedes ADR-014's "a souffleur change reloads the model until wllama can switch adapters
  in place": the vendored wllama (3.12.0-aparte-lfm3.1) already can.
- **Context**: every tool turn reloaded the model with the other adapter, and the chat then re-read its whole prompt to
  answer after the document — 43.5 s with the M5's GPU, 130 s without, for the one closing sentence; and since
  LFM3 has a 256-token sliding window and recurrent layers, even a plain next turn resumed only 516 tokens back.
- **Decision**: the engine loads the GGUF base with every adapter of the set already in the cache, once
  (`lora_init_without_apply`), and each request names its own (`lora: [{ id, scale: 1 }]`). Two cache slots of 8,192
  tokens, not one unified cache (`n_parallel: 2`, `kv_unified: false`): the chat keeps its slot while the expert
  uses the other. LFM3's sliding window is kept whole (`swa_full: true`) so a prompt resumes from the checkpoint 4
  tokens before its end. The onboarding downloads the executors before it warms the caller, so the warm-up's load
  has them. Vision stays a load of its own (base + mmproj).
- **Consequences**: no reload between the chat and the expert; the chat resumes after a document. The KV cache grows
  to 352 MiB (2 × 8,192 tokens, the sliding window whole) — about 160 MiB more than before. An adapter downloaded
  after the load joins at its first use with one reload. Do not "simplify" `kv_unified` or `swa_full` away: each one
  alone brings the full re-read back.
- **Evidence / references**: `aparte-repetitions/lab/2026-10-lfm3-bench/m5-prompt-cache-2026-11-05.md` (the causes,
  reproduced on a native llama-server built from the same llama.cpp source, `-lv 4`); the app on the M5 before and
  after (perf/engine-prompt-cache, `~/bench-lfm/out/` on the M5):

  | the app on the M5, returning user (c0.9 + v0.9) | GPU before | GPU after | CPU before | CPU after |
  |---|---|---|---|---|
  | invoice, first word | 13.2 s | 1.5 s | 71.7 s | 35.9 s¹ |
  | its closing sentence, time to first token | 43.0 s | 2.2 s | 131 s | 4.7 s |
  | invoice, total | 96.1 s | 35.1 s | 248 s | 78.2 s |
  | second document in the conversation, total | 106 s | 38.1 s | 240 s | 50.5 s |
  | a follow-up after an image, first word | 14.4 s | 1.4 s | 42.7 s² | 2.3 s |

  ¹ the first message waited for the end of the boot warm-up (130 s on the CPU; the run waits 90 s).
  ² that answer called render (272.8 s in all).
