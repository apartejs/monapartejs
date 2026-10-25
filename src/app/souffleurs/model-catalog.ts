/** souffleurs catalog — HF repo, adapters, sizes (for weighted progress). */

export const SOUFFLEURS_HF_REPO = 'apartejs/aparte-souffleurs';

export type AdapterName =
  'souffleur-chat' | 'souffleur-pdf' | 'souffleur-xlsx-docx' | 'souffleur-sandbox';

export const CALLER_ADAPTER: AdapterName = 'souffleur-chat';

/**
 * Vision (ADR-014) — the SAME base GGUF, loaded without adapter, plus the vision
 * encoder (mmproj): Liquid's F16 encoder requantized to Q4_0 with its 4304-wide FFN
 * padded to 4320 (exact), ~244 MB. Described by the manifest's `gguf.mmproj`.
 * Produced by `aparte-repetitions/export/build_gguf.py`.
 */

/**
 * Bounds of the describe call. 128 was truncating: a detailed description WITH
 * transcription of visible text (logo, screenshot, photographed document)
 * largely exceeds it. It stays bounded — the result feeds a tool turn, not a
 * reply to the user.
 */
export const VISION_MAX_NEW_TOKENS = 320;

/** Model id visible on the aparté side (selector, model config). */
export const CALLER_MODEL_ID = 'souffleur-chat';

// File paths (base + versioned adapters) are resolved by the HF repo's
// manifest.json — see ./manifest.ts. No more hardcoded path here.

/**
 * Approximate sizes (progress + generated onboarding text, never hardcoded elsewhere);
 * the manifest's sizes win when it publishes them. The executors' rank-128 adapters are
 * the largest (q8_0), the chat one is ~89 MB (f16).
 */
export const SIZE_BASE_BYTES = 731_000_000;
export const SIZE_ADAPTER_BYTES = 94_000_000;
export const SIZE_MMPROJ_BYTES = 244_000_000;
/** wllama's .wasm, served by the app (~9 MB) */
export const SIZE_OVERHEAD_BYTES = 9_000_000;
export const CALLER_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES + SIZE_OVERHEAD_BYTES;
/** Base + the 4 souffleurs (caller + 3 executors) — announced at onboarding. */
export const TOTAL_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES * 4 + SIZE_OVERHEAD_BYTES;

export const EXECUTOR_ADAPTERS = [
  'souffleur-xlsx-docx',
  'souffleur-pdf',
  'souffleur-sandbox',
] as const satisfies readonly AdapterName[];

/**
 * The caller's context window, in tokens: the engine's n_ctx (`N_CTX` in
 * engine/wllama-engine.ts), a hard limit since wllama allocates it. Declared on
 * the AparteAIModel so `<aparte-context>` has something to measure against and
 * the compaction selector can budget.
 */
export const CALLER_CONTEXT_WINDOW = 8_192;

/** Contract generation bounds (256 min caller — 64 truncated the announcement+call). */
export const CALLER_MAX_NEW_TOKENS = 256;
/**
 * An executor's prompt plus its output must fit the 8,192-token context. The old
 * 12,000 was only ever reached by a loop (F8), which the repetition guard now stops.
 */
export const EXECUTOR_MAX_NEW_TOKENS = 6_144;

// Weight versioning is carried by manifest.json (immutable versioned files)
// — publishing a new version = new name + manifest bump,
// NO code change here.
