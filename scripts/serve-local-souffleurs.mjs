/**
 * Serve unpublished souffleurs to the app, the way the HF repo does: a `manifest.json` (lfm3 block) and the GGUF
 * files, from wherever they are on disk — the lab's runs, not copies. For testing a model before it is published
 * (ADR-003's LFM3 souffleurs); the app reads it once `localStorage['bp.souffleurs.baseUrl']` points here.
 *
 *   node scripts/serve-local-souffleurs.mjs --base <base.gguf> --chat <chat-lora.gguf> --render <render-lora.gguf>
 *       [--mmproj <mmproj.gguf>] [--port 8501] [--rev <label>]
 *   then, in the app's console:  localStorage.setItem('bp.souffleurs.baseUrl', 'http://127.0.0.1:8501')
 *
 * Every response carries CORS and CORP headers: the app is cross-origin isolated (COEP credentialless) and wllama
 * fetches the files in CORS mode. Not part of the build; a dev tool only.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    base: { type: 'string' },
    chat: { type: 'string' },
    render: { type: 'string' },
    mmproj: { type: 'string' },
    port: { type: 'string', default: '8501' },
    rev: { type: 'string', default: `local-${new Date().toISOString().slice(0, 10)}` },
  },
});
for (const key of ['base', 'chat', 'render']) {
  if (!args[key]) throw new Error(`--${key} <path to the GGUF file> is required`);
}

// One URL per file, named after the file: a different run is a different name, so the browser cache never mixes them.
const files = {
  base: { path: args.base, url: `gguf/${basename(args.base)}` },
  chat: { path: args.chat, url: `gguf/chat-${basename(args.chat)}` },
  render: { path: args.render, url: `gguf/render-${basename(args.render)}` },
  // Optional: without it the manifest publishes no vision and read_file says so on an image.
  ...(args.mmproj ? { mmproj: { path: args.mmproj, url: `gguf/${basename(args.mmproj)}` } } : {}),
};
const size = (role) => statSync(files[role].path).size;
const manifest = {
  schema: 'aparte-souffleurs/1',
  // the LFM3 block, the one this app reads (the `gguf` block is the LFM2.5 app's in production)
  lfm3: {
    rev: args.rev,
    base: { file: files.base.url, size: size('base') },
    ...(files.mmproj
      ? { mmproj: { version: args.rev, file: files.mmproj.url, size: size('mmproj') } }
      : {}),
    souffleurs: {
      chat: { version: args.rev, file: files.chat.url, size: size('chat') },
      render: { version: args.rev, file: files.render.url, size: size('render') },
    },
  },
};
const byUrl = new Map(Object.values(files).map((f) => [`/${f.url}`, f.path]));

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};
createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...headers, 'Access-Control-Allow-Headers': '*' }).end();
    return;
  }
  if (path === '/manifest.json') {
    res.writeHead(200, {
      ...headers,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(manifest, null, 2));
    return;
  }
  const file = byUrl.get(path);
  if (!file) {
    res.writeHead(404, headers).end(`not found: ${path}`);
    return;
  }
  res.writeHead(200, {
    ...headers,
    'Content-Type': 'application/octet-stream',
    'Content-Length': statSync(file).size,
  });
  createReadStream(file).pipe(res);
}).listen(Number(args.port), '127.0.0.1', () => {
  console.log(`souffleurs on http://127.0.0.1:${args.port} (${args.rev})`);
  for (const [role, f] of Object.entries(files)) console.log(`  ${role}: ${f.url} <- ${f.path}`);
});
