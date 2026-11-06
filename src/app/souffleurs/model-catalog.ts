/** souffleurs catalog — HF repo, adapters, sizes (for weighted progress). */

export const SOUFFLEURS_HF_REPO = 'apartejs/aparte-souffleurs';

/** Where `manifest.json` and the GGUF files live. */
export const SOUFFLEURS_BASE_URL_KEY = 'bp.souffleurs.baseUrl';

/**
 * The HF repo, unless `localStorage['bp.souffleurs.baseUrl']` points elsewhere: the LFM3 souffleurs are not
 * published yet, and a test serves them from a local folder (with CORS) the same way.
 */
export function souffleursBaseUrl(): string {
  try {
    const override = localStorage.getItem(SOUFFLEURS_BASE_URL_KEY);
    if (override) return override.replace(/\/$/, '');
  } catch {
    /* storage unavailable: the published souffleurs */
  }
  return `https://huggingface.co/${SOUFFLEURS_HF_REPO}/resolve/main`;
}

/**
 * LFM3 (ADR-003): the caller and the json-render expert (`souffleur-render`). The LFM2.5 executors stay named so
 * their tools still compile; nothing registers them on this branch.
 */
export type AdapterName =
  | 'souffleur-chat'
  | 'souffleur-render'
  | 'souffleur-pdf'
  | 'souffleur-xlsx-docx'
  | 'souffleur-sandbox';

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
export const SIZE_BASE_BYTES = 1_100_000_000; // LFM3-Omni-2B Q4_K_M
export const SIZE_ADAPTER_BYTES = 90_000_000; // ffn LoRA, f16
export const SIZE_MMPROJ_BYTES = 244_000_000;
/** wllama's .wasm, served by the app (~10 MB) */
export const SIZE_OVERHEAD_BYTES = 10_000_000;
export const CALLER_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES + SIZE_OVERHEAD_BYTES;
/** Base + the 2 souffleurs (caller + the json-render expert) — announced at onboarding. */
export const TOTAL_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES * 2 + SIZE_OVERHEAD_BYTES;

export const EXECUTOR_ADAPTERS = ['souffleur-render'] as const satisfies readonly AdapterName[];

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
