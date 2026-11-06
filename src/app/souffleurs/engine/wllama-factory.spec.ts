import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

/** The folder name scripts/copy-wllama-assets.mjs gives these files: the start of their content's sha256. */
function contentDir(...specifiers: string[]): string {
  const require = createRequire(import.meta.url);
  const hash = createHash('sha256');
  for (const s of specifiers) hash.update(readFileSync(require.resolve(s)));
  return hash.digest('hex').slice(0, 12);
}

describe('createWllama', () => {
  it('serves wllama and its compat build from our own origin, never a CDN', () => {
    createWllama();
    expect((created[0].paths as { default: string }).default).toMatch(/^\/assets\/wllama\//);
    const compat = created[0].compat.at(-1) as { wasm: string; worker: string };
    expect(compat.wasm).toMatch(/^\/assets\/wllama-compat\//);
    expect(compat.worker).toMatch(/^\/assets\/wllama-compat\//);
  });

  it("names wllama's folders after their content: a cached file of another version is never run with this code (6/11)", () => {
    // The service worker caches the .wasm and serves the page from the network first: under one fixed URL, a new
    // page ran the previous deployment's .wasm — "Invalid typed array length: 1163217991", the bytes "GLUE" read as
    // a length, until the update button.
    createWllama();
    const main = contentDir('@wllama/wllama/esm/wasm/wllama.wasm');
    const compat = contentDir(
      '@wllama/wllama-compat/wasm/wllama.wasm',
      '@wllama/wllama-compat/wasm/wllama.js',
    );
    expect(created.at(-1)!.paths).toEqual({ default: `/assets/wllama/${main}/wllama.wasm` });
    expect(created.at(-1)!.compat.at(-1)).toEqual({
      wasm: `/assets/wllama-compat/${compat}/wllama.wasm`,
      worker: `/assets/wllama-compat/${compat}/wllama.js`,
    });
  });
});
