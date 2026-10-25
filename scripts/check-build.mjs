/**
 * Checks the production build for what the wllama engine needs at runtime, after `ng build`.
 *
 * Each check is a failure that once passed every other step silently:
 *  - wllama's .wasm and its compat build (Safari) must be served by the app itself — an
 *    `assets` glob into node_modules copies nothing on Linux CI with pnpm's symlinks, and
 *    wllama would otherwise fetch the compat build from a CDN;
 *  - the adapter-staging patch (ngxson/wllama#265) must be in the bundled code — the
 *    bundler compiles wllama's src/, and a patch of esm/ alone shipped every souffleur
 *    without its LoRA.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join('dist', 'monaparte', 'browser');
const failures = [];

for (const file of [
  'assets/wllama/wllama.wasm',
  'assets/wllama-compat/wllama.wasm',
  'assets/wllama-compat/wllama.js',
]) {
  if (!existsSync(join(dist, file))) failures.push(`missing ${file}`);
}

const chunks = existsSync(dist) ? readdirSync(dist).filter((f) => f.endsWith('.js')) : [];
const engine = chunks.find((f) => readFileSync(join(dist, f), 'utf8').includes('lora_paths'));
if (!engine) failures.push('no chunk carries wllama (lora_paths not found)');
else if (!readFileSync(join(dist, engine), 'utf8').includes('/models/lora-')) {
  failures.push(`${engine}: wllama is bundled WITHOUT the adapter-staging patch`);
}

if (failures.length) {
  console.error(`[check-build] ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('[check-build] wllama assets served locally, adapter-staging patch bundled');
