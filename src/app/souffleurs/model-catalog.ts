/** souffleurs catalog — HF repo, adapters, sizes (for weighted progress). */

export const SOUFFLEURS_HF_REPO = 'maxituc/aparte-souffleurs';

export type AdapterName =
  'souffleur-chat' | 'souffleur-pdf' | 'souffleur-xlsx-docx' | 'souffleur-sandbox';

export const CALLER_ADAPTER: AdapterName = 'souffleur-chat';

/**
 * Vision (ADR-001) — SAME repo, SAME weights, SAME graph as text.
 * The published graph (`onnx/model_vision_q4.onnx`) is our base with an
 * `image_features`/`image_indices` input gate grafted on: bit-identical in
 * text (measured logits gap 0.000e+00), so it's used for everything. The
 * only extra artifact is the TOWER (`vision-tower-<ver>`, ~269 MB), described
 * by the manifest's `vision` block and attached in a separate session on the
 * 1st image.
 * Produced by `aparte-repetitions/export/graft_image_embeds.py`.
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

/** Approximate sizes (progress + generated onboarding text, never hardcoded elsewhere). */
export const SIZE_BASE_BYTES = 795_000_000;
export const SIZE_ADAPTER_BYTES = 86_000_000;
/** config + tokenizer + graph (~5 MB) */
export const SIZE_OVERHEAD_BYTES = 5_000_000;
export const CALLER_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES + SIZE_OVERHEAD_BYTES;
/** Base + the 4 souffleurs (caller + 3 executors) — announced at onboarding. */
export const TOTAL_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES * 4 + SIZE_OVERHEAD_BYTES;

export const EXECUTOR_ADAPTERS = [
  'souffleur-xlsx-docx',
  'souffleur-pdf',
  'souffleur-sandbox',
] as const satisfies readonly AdapterName[];

/** Contract generation bounds (256 min caller — 64 truncated the announcement+call). */
export const CALLER_MAX_NEW_TOKENS = 256;
export const EXECUTOR_MAX_NEW_TOKENS = 12_000;

// Weight versioning is carried by manifest.json (immutable versioned files)
// — publishing a new version = new name + manifest bump,
// NO code change here.
