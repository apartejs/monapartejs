import { describe, expect, it, vi } from 'vitest';

const created: { paths: unknown; compat: unknown[] }[] = [];

vi.mock('@wllama/wllama', () => ({
  CacheManager: class {},
  Wllama: class {
    readonly calls = { paths: undefined as unknown, compat: [] as unknown[] };
    constructor(paths: unknown) {
      this.calls.paths = paths;
      created.push(this.calls);
    }
    setCompat(compat: unknown) {
      this.calls.compat.push(compat);
    }
  },
}));

const { createWllama } = await import('./wllama-engine');

describe('createWllama', () => {
  it('serves wllama and its compat build from our own origin, never a CDN', () => {
    createWllama();
    expect(created[0].paths).toEqual({ default: '/assets/wllama/wllama.wasm' });
    expect(created[0].compat.at(-1)).toEqual({
      wasm: '/assets/wllama-compat/wllama.wasm',
      worker: '/assets/wllama-compat/wllama.js',
    });
  });
});
