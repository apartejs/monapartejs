/**
 * The adapter-staging patch (ngxson/wllama#265) must be in the code the app actually
 * compiles. wllama's package.json points `main` at a missing index.js, so bundlers fall
 * back to its root index.ts → src/: patching only esm/ left the bundle unpatched and
 * every souffleur loaded without its LoRA (found by the branch review, 2026-10-25).
 */
import { describe, expect, it } from 'vitest';
import { Wllama } from '@wllama/wllama';

describe('wllama adapter-staging patch', () => {
  it('mounts adapter blobs and points lora_paths at them', () => {
    const loadModel = Wllama.prototype.loadModel.toString();
    expect(loadModel).toContain('lora-');
    expect(loadModel).toContain('/models/lora-');
  });
});
