/**
 * Copy wllama's .wasm and its compat build into `public/assets/` before a build or a serve.
 *
 * Same reason as copy-titler-model.mjs: an `assets` glob into node_modules follows pnpm's
 * symlinks on Windows and copies NOTHING on Linux, where the image is built. The engine
 * must find these files on our own origin — never a CDN: nothing leaves the device, and
 * the app must start offline.
 *  - `wllama/wllama.wasm`: the build every recent Chromium runs (JSPI + Memory64);
 *  - `wllama-compat/`: what wllama switches to without them (Safari). Left to its
 *    default, wllama would fetch it from jsDelivr.
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);

const copies = [
  ['@wllama/wllama/esm/wasm/wllama.wasm', 'wllama'],
  ['@wllama/wllama-compat/wasm/wllama.wasm', 'wllama-compat'],
  ['@wllama/wllama-compat/wasm/wllama.js', 'wllama-compat'],
];

for (const [specifier, folder] of copies) {
  const source = require.resolve(specifier);
  const directory = join('public', 'assets', folder);
  mkdirSync(directory, { recursive: true });
  copyFileSync(source, join(directory, basename(source)));
  console.log(`[wllama] ${specifier} -> ${join(directory, basename(source))}`);
}
