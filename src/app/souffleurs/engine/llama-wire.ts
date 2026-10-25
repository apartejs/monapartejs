import type { ComputeDevice } from '../worker-protocol';

/** The timings llama.cpp attaches to a completion (wllama `ResultTimings`, the fields we read). */
export interface LlamaTimings {
  cache_n: number;
  prompt_n: number;
  prompt_ms: number;
  predicted_n: number;
  predicted_ms: number;
}

const BOS = '<|startoftext|>';

/**
 * The wire prompt carries its own `<|startoftext|>` (it is the training text, verbatim).
 * llama.cpp adds a BOS of its own, so one is removed — measured on the M5: the 1,745-token
 * prompt counts 1,746 when sent as-is, 1,745 without its BOS.
 */
export function toLlamaPrompt(wirePrompt: string): string {
  return wirePrompt.startsWith(BOS) ? wirePrompt.slice(BOS.length) : wirePrompt;
}

/** `n_gpu_layers` for wllama: 0 keeps the model on the CPU; undefined lets it offload every layer. */
export function gpuLayers(device: ComputeDevice): number | undefined {
  return device === 'wasm' ? 0 : undefined;
}

/**
 * Usage for the provider. With the prompt cache, `prompt_n` only counts the tokens that
 * were actually processed; the context the model saw is `cache_n + prompt_n`.
 */
export function usageFromTimings(
  t: LlamaTimings | undefined,
  ttftMs: number,
  durationMs: number,
): { inputTokens: number; outputTokens: number; ttftMs: number; durationMs: number } {
  return {
    inputTokens: t ? t.cache_n + t.prompt_n : 0,
    outputTokens: t?.predicted_n ?? 0,
    ttftMs,
    durationMs,
  };
}
