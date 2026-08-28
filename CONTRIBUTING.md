# Contributing to monaparte

monaparte is the reference product for [aparté](https://apartejs.dev): an assistant whose
language model runs entirely in the browser. The repository is small and moves fast; this
guide says how a change lands on `main`.

## Principles

1. **Think before coding.** Three lines — problem, approach, what changes, what does not —
   before opening a file.
2. **Simplicity first.** An abstraction is justified once duplication crosses three
   places, not before.
3. **One concern per commit.** No drive-by refactors.
4. **Every change is proven**: a test, a measurement, or a browser validation written in
   the commit message.

## Language

The repository is in English: documentation, commit messages, comments, identifiers.
Two exceptions, on purpose:

- text meant for the **model** (system prompt, tool descriptions, executor prompts) stays
  in the language of the training contract — it is model input, not documentation;
- **UI strings** are localised (`fr` and `en`) in `src/app/core/i18n/translations.ts`.

Some older comments are still in French. Translate them when you touch the file.

## What not to change lightly

- `src/app/souffleurs/wire/tool-defs.ts`, `wire/system-prompt.ts` and
  `executors/executor-prompts.ts` are the model's **training contract**, ported verbatim.
  They are regenerated from the lab (`aparte-repetitions`), never rephrased. A moved
  comma puts the model out of distribution — and it is measured: one sentence added to
  the system prompt changes nothing, token for token (see the comment in
  `system-prompt.ts`).
- `docker/nginx.conf`, `docker/Dockerfile` and `docs/DEPLOY-COOLIFY.md`: every line there
  cost an evening. Read the comment before touching the line.
- The `bp-` (selectors) and `bp.` (`localStorage` keys) prefixes are inherited from the
  project's first name (bonaparte). They are not renamed: browsers hold those keys
  ([ADR-010](docs/decisions/010-bp-prefixes-kept.md)).

## Setup

```bash
pnpm install
pnpm start          # http://localhost:4200 — COOP/COEP served by ng serve
pnpm verify         # what CI runs: lint, format, app types, worker types, tests
```

Node 24 (`.nvmrc`), pnpm 10 through corepack. The first launch downloads ~1.1 GB from
Hugging Face. Before looking for a bug anywhere else, check `crossOriginIsolated === true`
in the console.

`typecheck` and `typecheck:worker` are two separate passes, and that is not redundancy:
`tsc` does not follow `new Worker(new URL(...))`, so the inference worker is only checked
by the second one.

## Branches and commits

- `main` deploys automatically (GitHub Actions → GHCR → Coolify). Nobody pushes to it
  directly: branch, then PR, even alone.
- Branch prefixes: `feat/`, `fix/`, `chore/`, `docs/`.
- Conventional commits in English, `type(scope): what — why`. The "why" is the useful part;
  the repository history is the proof.
- A commit that touches the interface says **what was verified in the browser**.

## Reporting a problem

- **Application bug**: browser and version, GPU, the value of `crossOriginIsolated`, and
  the content of `/debug/prompt` if the model is involved.
- **The model answers badly**: that is not an application bug. Known limits are in the
  README ("Status"). A verbatim reproduction with the prompt actually sent
  (`/debug/prompt`) is welcome — it feeds the next training pass.
- **Security**: never as a public issue, see [SECURITY.md](SECURITY.md).
- Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Scope

This repository contains **neither** the library (`apartejs/aparte`) **nor** the model
training. A library defect is reported there; here we consume the published `@aparte/*`
packages, never a local link. Structural decisions are in [docs/decisions/](docs/decisions/)
and the direction in [ROADMAP.md](ROADMAP.md).
