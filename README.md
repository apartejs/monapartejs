# Monaparté

[![CI](https://github.com/apartejs/monapartejs/actions/workflows/deploy.yml/badge.svg)](https://github.com/apartejs/monapartejs/actions/workflows/deploy.yml)
[![MIT licence](https://img.shields.io/badge/licence-MIT-b07d33.svg)](LICENSE)

A conversational assistant whose language model runs **entirely in the browser**. There
is no inference server: the conversation, attached files and produced documents never
leave the visitor's device. The server only serves static files.

Live at **[mon.apartejs.dev](https://mon.apartejs.dev)** · the showcase of
**[aparté](https://apartejs.dev)**, the chat-interface library.

---

## Getting started

```bash
pnpm install
pnpm start        # http://localhost:4200
```

Node 24, pnpm 10 (through corepack). On first launch the browser downloads the model from
Hugging Face; allow a few minutes and keep the tab open.

| Command | What it does |
|---|---|
| `pnpm verify` | lint + format + app types + **worker** types + tests — what CI runs |
| `pnpm test` | Vitest, no browser |
| `pnpm lint`, `pnpm format` | ESLint (`--max-warnings 0`) and Prettier |
| `pnpm build` | production build into `dist/monaparte/browser` |
| `node tools/render-assets.mjs` | rebuilds the social card and icons from the SVGs |

`typecheck` and `typecheck:worker` are **two** commands, and that is not an oversight:
`tsc` does not follow `new Worker(new URL(...))`, so the inference worker is never checked
by the application pass. Without the second one, a type error there reaches production.

---

## How it runs

A **single** model serves everything. Specialisations are LoRA adapters swapped in at call
time — the "souffleurs" (prompters) — and image understanding is a separate encoder
attached the same way, on the first image. That is what keeps it to one download instead of
one model per use case.

```
browser
 ├── main thread      aparté interface, tools, Dexie persistence
 └── worker           transformers.js on WebGPU (WebAssembly fallback)
                       ├── shared base                          795 MB
                       ├── 4 LoRA adapters (86 MB each)         344 MB
                       └── vision tower, on demand              269 MB
```

About 1.14 GB on first launch, 1.4 GB once an image has been analysed. Everything comes
from [`maxituc/aparte-souffleurs`](https://huggingface.co/maxituc/aparte-souffleurs) and
then lives in the browser's Cache API. File paths are resolved through the repository's
`manifest.json`: publishing new weights requires no code change.

One souffleur calls, three execute: `souffleur-chat` leads the conversation and decides on
tools; `souffleur-pdf`, `souffleur-xlsx-docx` and `souffleur-sandbox` do the work. The
available tools are reading an attached file (images included), producing xlsx/docx/pdf,
deterministic conversion, exact computation in a sandbox, artifacts (chart, code, HTML,
SVG), local reminders, and the clarifying question.

### Two non-negotiable requirements

**COOP and COEP.** Without `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` there is no `SharedArrayBuffer`, hence no
multi-threaded WebAssembly, hence inference too slow to be usable — **and no error
message**. Check `crossOriginIsolated === true` in the console before looking anywhere
else.

**A secure context.** WebGPU and `SharedArrayBuffer` require HTTPS (or `localhost`).

---

## The code

| Folder | What you find there |
|---|---|
| `src/app/souffleurs/` | everything touching the model: worker, manifest, tools, vision, wire format |
| `src/app/souffleurs/wire/` | system prompt, tool-call parsing, stream demultiplexing |
| `src/app/storage/` | Dexie: conversations, messages, attachments, artifacts, files |
| `src/app/core/` | aparté configuration, theme, i18n, model status |
| `src/app/features/`, `pages/` | interface: settings, search, privacy, chat, debugging |
| `docker/`, `.github/workflows/` | service image and deployment pipeline |

The repository is in **English**. Text meant for the model — system prompt, tool
descriptions — stays in **the language of the training contract** and is never
translated: it is model input, not documentation. The interface is localised (fr/en).

### Debugging

Wire traces (prompt sent, raw output, parsed calls) are on by default in development. On
the deployed site they are silent; to turn them back on:

```js
localStorage.setItem('bp.debug', '1')   // then reload
```

`/debug/prompt` shows the last real exchange with its checks (tool list present, single
BOS, open assistant turn, tool call detected).

---

## Deployment

The build runs on GitHub, never on the server: a production Angular build needs several GB
of memory. Coolify only pulls the published image.

```
push to main → GitHub Actions → ghcr.io/apartejs/monapartejs:main → Coolify webhook
```

The details — and above all the traps that each cost an evening: a healthcheck on
`localhost` resolving to IPv6, an image never re-pulled for lack of `pull_policy` — are in
**[docs/DEPLOY-COOLIFY.md](docs/DEPLOY-COOLIFY.md)**. Read it before touching the
configuration in front of a 503.

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) says how a change lands on `main`;
[ROADMAP.md](ROADMAP.md) where this is going and what 1.0 contains;
[docs/decisions/](docs/decisions/) why things are the way they are.
Security: [SECURITY.md](SECURITY.md). Licence: [MIT](LICENSE).

## Status

The model is small and still learning. It shows what an on-device assistant can do; it
does not compete with a hosted model. Its measured limits are logged as they show up in
use and feed the next training pass.
