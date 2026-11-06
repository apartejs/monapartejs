/**
 * Checks the production build for what the wllama engine needs at runtime, after `ng build`.
 *
 * Each check is a failure that once passed every other step silently:
 *  - wllama's .wasm and its compat build (Safari) must be served by the app itself — an
 *    `assets` glob into node_modules copies nothing on Linux CI with pnpm's symlinks, and
 *    wllama would otherwise fetch the compat build from a CDN;
 *  - each of their folders must be named after the files it serves, and the bundle must point
 *    there — under one fixed URL the service worker gave a new page the previous deployment's
 *    .wasm ("Invalid typed array length: 1163217991", 6/11);
 *  - the adapter-staging patch (ngxson/wllama#265) must be in the bundled code — the
 *    bundler compiles wllama's src/, and a patch of esm/ alone shipped every souffleur
 *    without its LoRA;
 *  - the slot save/restore actions (wllama 3.12.0-aparte-lfm3.2, ADR-018) must be in the bundled code and in both
 *    .wasm builds — with an older build the boot warm-up still works, but is read again at every start.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = join('dist', 'monaparte', 'browser');
const failures = [];

// The paths the engine uses, as scripts/copy-wllama-assets.mjs wrote them.
const generated = readFileSync(
  join('src', 'app', 'souffleurs', 'engine', 'wllama-assets.ts'),
  'utf8',
);
const urls = [...generated.matchAll(/'(\/assets\/[^']+)'/g)].map((m) => m[1]);
if (urls.length !== 3) failures.push(`wllama-assets.ts: expected 3 paths, found ${urls.length}`);

const folders = new Map();
for (const url of urls) {
  const file = url.slice(1);
  if (!existsSync(join(dist, file))) failures.push(`missing ${file}`);
  else {
    const folder = file.slice(0, file.lastIndexOf('/'));
    folders.set(folder, [...(folders.get(folder) ?? []), file]);
  }
}
for (const [folder, files] of folders) {
  const hash = createHash('sha256');
  for (const file of files.sort((a, b) =>
    a.endsWith('.wasm') ? -1 : b.endsWith('.wasm') ? 1 : 0,
  )) {
    hash.update(readFileSync(join(dist, file)));
  }
  const name = folder.slice(folder.lastIndexOf('/') + 1);
  if (hash.digest('hex').slice(0, 12) !== name) {
    failures.push(
      `${folder}: the folder's name is not its files' content — run scripts/copy-wllama-assets.mjs`,
    );
  }
}

const chunks = existsSync(dist) ? readdirSync(dist).filter((f) => f.endsWith('.js')) : [];
const engine = chunks.find((f) => readFileSync(join(dist, f), 'utf8').includes('lora_paths'));
if (!engine) failures.push('no chunk carries wllama (lora_paths not found)');
else if (!readFileSync(join(dist, engine), 'utf8').includes('/models/lora-')) {
  failures.push(`${engine}: wllama is bundled WITHOUT the adapter-staging patch`);
}
const bundled = chunks.map((f) => readFileSync(join(dist, f), 'utf8')).join('\n');
for (const url of urls) {
  if (!bundled.includes(url)) failures.push(`the bundle does not point at ${url}`);
}

for (const url of urls.filter((u) => u.endsWith('.wasm'))) {
  const path = join(dist, url.slice(1));
  if (existsSync(path) && !readFileSync(path).includes('slot_restore')) {
    failures.push(`${url} has no slot save/restore (wllama older than 3.12.0-aparte-lfm3.2)`);
  }
}
if (engine && !readFileSync(join(dist, engine), 'utf8').includes('srst_req')) {
  failures.push(`${engine}: wllama is bundled without restoreSlot`);
}

if (failures.length) {
  console.error(`[check-build] ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(
  '[check-build] wllama assets served locally under content-named folders, adapter-staging patch and slot actions bundled',
);
