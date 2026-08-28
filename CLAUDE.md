# CLAUDE.md — monaparte

The reference product for [aparté](https://apartejs.dev): a conversational assistant whose
language model runs entirely in the browser. Angular 19 standalone, pnpm, Vitest. It consumes
`@aparte/*` **from npm** — never a local link to `../apartejs`.

## Language

**This repository is in English.** Documentation, commit messages, code comments,
identifiers, issue and PR text. Two deliberate exceptions:

- **Model-facing text** (system prompt, tool descriptions, executor prompts) stays in the
  language of the training contract, verbatim — it is model input, not documentation.
- **UI strings** live in `src/app/core/i18n/translations.ts` in both `fr` and `en`.

Older French comments are legacy: translate them when you touch the file, never in a
drive-by sweep.

## Rules

1. `pnpm verify` before claiming anything works — lint, format, app types, **worker types**,
   tests. `typecheck:worker` is a separate pass on purpose: `tsc` does not follow
   `new Worker(new URL(...))`, so the inference worker belongs to no program otherwise.
2. **The contract is verbatim.** `souffleurs/wire/tool-defs.ts`, `wire/system-prompt.ts`,
   `executors/executor-prompts.ts` are regenerated from the lab, never rephrased. Measured:
   adding one sentence to the system prompt changes nothing, token for token (see
   `system-prompt.ts`). A model that answers badly is a data problem, fixed in
   `aparte-repetitions`, and logged in `FRICTIONS-MODELE.local.md` (gitignored) with a
   verbatim reproduction and a measurement.
3. **Branches, never `main`.** Every push to `main` builds an image and deploys it. Merging
   is Paul's decision, separate from a "go" on the work itself.
4. **UI changes are validated in a real browser** and the commit says what was seen. The
   `/debug/artefacts` harness does not replace the real path — it once hid a bug.
5. **Prod 503 → `docker inspect` first**, before touching any configuration
   (`docs/DEPLOY-COOLIFY.md` §3). Every deployment trap in that file cost an evening.
6. **Decisions live in `docs/decisions/`.** Do not reopen one without new data; write a new
   one that supersedes it. Direction: `ROADMAP.md`.
7. Conventional commits, English: `type(scope): what — why`. The "why" is the useful part.

## Map

| Path | What |
|---|---|
| `src/app/souffleurs/` | provider, inference worker, HF manifest, tools, vision, wire contract |
| `src/app/storage/` | Dexie: conversations, souffleur files, artifacts, settings, export/import |
| `src/app/core/aparte.config.ts` | the one place that wires the library |
| `src/app/features/`, `pages/`, `layout/`, `onboarding/` | the interface |
| `docker/`, `.github/workflows/` | image and deployment |

## Neighbours

- `../apartejs` — the library. Read its `CLAUDE.md` before "raising it to the lib".
- `../aparte-repetitions` — training, contract, handoffs, model ADRs. When Paul points
  there, the decision is already written down.
