# ADR-014 — The in-browser engine is wllama, with LoRA adapters as GGUF

- **Date**: 2026-10-25
- **Status**: accepted. Supersedes the *engine* part of ADR-004 (ONNX graph, adapters
  remapped through `session_options.externalData`); ADR-004's versioned `manifest.json` and
  immutable file names stand. The switch ships only once vision passes its gate (below).
- **Context**: transformers.js re-reads the whole prompt on every turn — 20 s before the first
  token on the reference machine (GMKtec M5, Ryzen 7 5825U, Vega 8), every turn — and the
  souffleurs graph does not load without WebGPU (`GatherBlockQuantized` has no CPU kernel, in
  4.2.0 and 4.3.1). wllama (llama.cpp in WASM/WebGPU) keeps a prompt cache, runs on CPU, and
  applies our LoRA once it is staged.
- **Decision**: monaparté runs its souffleurs on `@wllama/wllama`: base as GGUF Q4_K_M, each
  souffleur as a GGUF LoRA adapter (f16), converted with `convert_lora_to_gguf.py` from the
  same PEFT adapters. wllama's missing adapter staging is carried as a `pnpm patch` of
  ngxson/wllama#265 until it is merged. Inference goes through raw completion with our own
  wire prompt and pythonic parser, as today. A souffleur change reloads the model until wllama
  can switch adapters in place.
- **Consequences**: the lab exports GGUF instead of an injected ONNX graph; the eval runs on
  llama.cpp with the same files. Vision moves to wllama's `mmproj` path — the current ONNX
  tower feeds the ONNX decoder and cannot serve a GGUF base — so the switch waits until vision
  is measured correct on the M5. The no-WebGPU path becomes supported, with a "first answer is
  slow" hint. The engine lives in the app (`src/app/souffleurs/`); moving it into aparté as a
  provider is not decided here — it gets its own spec later, written from what the app has
  proven.
- **Evidence / references**: measured on the M5, headless Chromium with the real iGPU, the
  app's 1,745-token prompt, `souffleur-chat` 0.3.0 —

  | | transformers.js 4.2.0 + LoRA | wllama 3.8.1 + LoRA, GPU | wllama 3.8.1 + LoRA, CPU |
  |---|---|---|---|
  | decode | 11.7 t/s | 13.6 t/s | 13.8 t/s |
  | first token, next turns | 20.3 s | 1.3 s | 2.8 s |
  | without WebGPU | does not load | — | works |

  The LoRA changes wllama's answers to the souffleur's own, as in transformers.js. Design:
  `docs/superpowers/specs/2026-10-25-model-rework-design.md` §6.5.
