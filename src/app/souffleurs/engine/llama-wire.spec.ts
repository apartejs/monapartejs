import { describe, expect, it } from 'vitest';
import { gpuLayers, toLlamaPrompt, usageFromTimings } from './llama-wire';

describe('toLlamaPrompt', () => {
  it('removes exactly one leading BOS — llama.cpp adds its own', () => {
    expect(toLlamaPrompt('<|startoftext|><|im_start|>system\nX')).toBe('<|im_start|>system\nX');
    expect(toLlamaPrompt('<|im_start|>user\nX')).toBe('<|im_start|>user\nX');
    expect(toLlamaPrompt('<|startoftext|><|startoftext|>a')).toBe('<|startoftext|>a');
  });
});

describe('gpuLayers', () => {
  it('keeps the model on the CPU for wasm, lets wllama offload everything on webgpu', () => {
    expect(gpuLayers('wasm')).toBe(0);
    expect(gpuLayers('webgpu')).toBeUndefined();
  });
});

describe('usageFromTimings', () => {
  it('counts cached and processed prompt tokens', () => {
    expect(
      usageFromTimings(
        { cache_n: 1742, prompt_n: 39, prompt_ms: 1174, predicted_n: 32, predicted_ms: 1800 },
        1180,
        2975,
      ),
    ).toEqual({ inputTokens: 1781, outputTokens: 32, ttftMs: 1180, durationMs: 2975 });
  });

  it('keeps the measured times when the engine reports no timings', () => {
    expect(usageFromTimings(undefined, 10, 20)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      ttftMs: 10,
      durationMs: 20,
    });
  });
});
