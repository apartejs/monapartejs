# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [SemVer](https://semver.org/). Until 1.0 is tagged, the deployed version is `main`.

## [Unreleased]

### Added
- Monaparté has its own colour (ADR-012) and its own mark (ADR-013): Angular's
  magenta-violet as the interface accent, and the mascot at home in a house-shaped
  speech bubble — a body, walls in the accent, and a warm light behind the face,
  which keeps the library's brass. One geometry (`mark.ts`) drawn by the component,
  the launcher icons, the favicon (the silhouette, solid, its colour the state) and
  the social card, with a test that keeps them identical.
- The mascot has real states, in the manner of aimi's robot: it blinks; thinks with
  dots in the attic and a breathing light; talks with a flapping mouth and a lit
  tail; bounces when happy, with hearts on a click; shakes red on an error; sleeps
  under rising z's; is surprised by a hover and looks around when the cursor goes
  quiet. Its eyes follow the cursor on the home screen and in the corner, and the
  corner has a happy beat when a generation ends. `/debug/mascotte` shows every
  state without a model.
- MIT licence, contributing guide, code of conduct, security policy, roadmap, decision
  records (`docs/decisions/`), issue and PR templates, Dependabot.
- ESLint (angular-eslint) and Prettier; `pnpm verify` now runs lint and format checks
  before types and tests.
- `pnpm typecheck` runs `ngc` instead of `tsc`, so Angular templates are checked too: a
  binding to a missing property, or an input given the wrong type, used to compile clean
  and only fail at `ng build`.

- The chat scrollbar runs the height of the column and sits at the edge of the page,
  where a page's scrollbar belongs, instead of floating against a centred one. Two
  halves: horizontally, we stopped imposing our own `max-width` on the scroll surface
  and let the library centre the content it already knows how to centre
  (`.aparte-message` and `.aparte-composer-shell` both carry
  `max-width: var(--aparte-message-max-width); margin: 0 auto`); vertically, aparté
  0.16.2's `overlayComposer` floats the composer over a full-height transcript. Making
  the document scroll instead was never an option — the layout guide is explicit that
  a transcript which does not scroll reports `scrollHeight === clientHeight`, so the
  follow rule, the scroll-to-bottom button and the reader-gesture detection all go
  quiet, silently. The three scrollbar tokens are set for the first time, so the chat's
  bar no longer reads as a second, foreign one.
- The hand-rolled conversation minimap is replaced by `<aparte-scroll-rail>`: one tick
  per user turn, real buttons walked by the arrow keys where ours was `aria-hidden`
  with `tabindex="-1"`, and the current message read from an intersection observer
  rather than from scroll arithmetic. 161 lines deleted.
- The context gauge is the library's (`<aparte-context variant="ring">`), and it reads
  the truth: the `inputTokens` the worker actually reports, against the model's declared
  window. The hand-rolled readout estimated tokens from message text against a hardcoded
  4096, and did nothing when it turned red. The model now declares `contextWindow: 32768`
  — its real maximum. Note this is a ceiling, not a comfortable size: nothing reuses a KV
  cache between turns, so a conversation near the window re-prefills it at every send.
- Compaction, answered by `@aparte/plugin-compaction` at 90 % of the window. The
  selector is the library's, budget-aware; the summary is **not** written by the model.
  Measured on souffleur-chat 0.3.0 over six generations: asked to summarise it refuses,
  answers as if continuing the chat, or invents — one run produced a second client's
  amounts that appeared nowhere in the transcript. So `summarize` is deterministic
  (`core/compaction-digest.ts`): dropped-turn count, the original request, files
  produced, tools run — read off the messages, nothing generated. It also sidesteps the
  transport, which matters: the plugin passes its instruction as a `system` message, and
  our provider imposed the contract's own system prompt, so that instruction never
  reached the model at all — reported as apartejs/aparte#45 and fixed in 0.16.1, where
  the instruction rides the final user turn. Remeasured against that fix: the model does
  then attempt a summary, and one of three was usable — but it still invents (a decision
  that was only ever requested), still answers in the instruction's language rather than
  the conversation's, and loops on the longest transcript until the token budget runs
  out. That last one is decisive: a summariser that degrades with length is no use to
  compaction, which fires precisely when the conversation is long. Logged as F12.

- `@aparte/*` 0.16.2 → 0.16.9. What mattered to us: 0.16.3 corrects the viewport's
  box-sizing in the overlay-composer mode we had just adopted, and 0.16.8 consolidates
  the token set. Every `--aparte-*` we read was checked against the 441 the package now
  declares; two came back unknown. `--aparte-bottom-inset` is published by the viewport
  at runtime rather than in CSS, so that one is fine. `--aparte-on-primary` never
  existed at all — the download button on an artifact card was painting
  `var(--aparte-on-primary, #fff)`, so it had always been the fallback doing the work.
  It now uses `--aparte-primary-ink`, which core derives from the accent in oklch; a
  fixed ink on a brand fill is the bug core itself documents fixing, measured at 1.11:1
  on a navy.

- Conversation titles come from `@aparte/titler-efigsp`: 77 KB, six languages, on the
  person's machine, 6 ms. The library titles by truncating the first user message; this
  reads the three to six words that carry it — "Fais-moi une facture pour 3 jours de
  conseil à 400 € par jour" becomes "facture 3 jours conseil 400 jour". It is
  extractive, which is the property that matters here: the output can only be words
  copied from the message, so the one label we render from arbitrary user text cannot
  be steered by instructions inside it. Loaded by dynamic import, so it stays out of the
  initial bundle. Titled once, at the first user message, never again — nothing on a
  conversation distinguishes an automatic title from a rename someone chose.

### Changed
- The souffleurs live at `apartejs/aparte-souffleurs` on Hugging Face. The old
  `maxituc/…` id now answers with a 307, and we were relying on that redirect for 886 MB
  of weights and for a `manifest.json` fetched with `no-store`.

### Fixed
- The deployment job says it queues, because that is all it does. It reported three
  green deployments on 2 September while all three had failed in Coolify, and the site
  stayed four days behind `main` with no red mark anywhere: the endpoint answers
  "deployment queued" and returns, and nothing waited for the outcome. The step is
  renamed and now leaves a warning on the run summary, so a green check cannot be read
  as deployed.
- The titler is one package again. `@aparte/titler-efigsp` 1.0.4 moves the
  file-system read behind the `node` export condition and makes the portable entry the
  default, so importing it no longer drags `node:url` into a browser build — reported
  from here as apartejs/aparte-titler-model#2. `loadTitler()` now takes the model as an
  argument, so the `.bin` we already copy is simply handed to it, and `@aparte/titler`
  is gone. The report also uncovered a second defect we had worked around without
  naming: no bundler rewrites `import.meta.url`, so the no-argument `loadTitler()`
  resolved next to the bundle and would have 404'd whatever we did.
- The titler's model is copied by a script before every build and serve, instead of by
  an `assets` glob. With pnpm, `node_modules/@aparte/titler-efigsp` is a symlink into
  `node_modules/.pnpm/`: the glob followed it on Windows, where pnpm uses junctions,
  and produced nothing on Linux — with no warning, so CI stayed green and the deployed
  site answered 404 on the model. The titler then failed to load and titles fell back
  to the library's truncation, which nobody would have noticed. `require.resolve`
  follows the symlink on every platform, and the package's `"./model"` export subpath
  is the supported way to ask for the file.
- The titler no longer starts a title mid-word, so our guard against it is gone.
  `@aparte/titler-efigsp` 1.0.2 scores a hyphenated or apostrophed word whole, which
  was reported from here as apartejs/aparte-titler-model#1 and fixed the same day.
  Remeasured on the eight probes that found it: no title begins with a fragment, and
  "Pourrais-tu vérifier les calculs de la facture" now yields "vérifier les calculs de
  la facture". Two cases improved beyond the report — "Rappelle-moi" and
  "Explique-moi" keep their pronoun where 1.0.1 cut it off.
- `pnpm verify` now builds. It ran lint, format, types, templates, the worker's types
  and the tests — everything except the one command the deployment actually runs. A
  browser-hostile import in a dependency passed all of it, was tolerated by
  `ng serve`, and failed in CI at `pnpm build`, which is the same lesson the `ngc`
  note in CLAUDE.md already records for templates: what is not run is not checked.
- The download showed `18.404171932196558 %`: the aggregator hands out whole
  percentages, but weighting them by the caller's share of the bytes made a float,
  printed as is. The service now floors, at its single point of writing.
- The corner mascot sat over the chat column when the sidebar was open, and slid
  behind the composer while the window was resized: its media query read the
  viewport, which cannot see the 268 px of sidebar. The gutter is now computed
  from the main area (`layout/corner-mascotte.ts`, tested with real widths), and a
  laptop with the sidebar open keeps a smaller mascot rather than losing it.
- The mark had drifted into four different drawings; the favicon declared a house
  the decision said it must not have, and the dynamic favicon rewrote the `.ico`
  link instead of the SVG one; `favicon.ico` was July's brass face; the sidebar
  wordmark still read "aparté". The face bobbed in `steps(24)` inside an immobile
  house — jitter at 14 px, a snap on every state change, a freeze mid-bob during
  the decode — and the state light at 7 % was invisible in the light theme. A happy
  face `(^.^)` ran into the walls: Georgia's `^` is three times an apostrophe's
  width, so the happy eyes are `ˆ` and the surprised ones `°`.
- Executors: the task is prefixed with `intent: ` as in 100 % of the training examples —
  every file generation was going out of distribution.
- PDF sandbox: `autoTable` exposed as a global in addition to `doc.autoTable`; the prompt
  advertised both forms, only one worked.
- `ask_question`: the observation returned to the model has the dataset's shape
  (`{ok, type, answers}`); the displayed receipt is rebuilt from that JSON.

### Changed
- `@aparte/*` 0.13.0 → 0.13.1 → 0.14.0 → 0.15.1. With 0.14: the memory-fact and
  artifact row types are ours (`storage/db.ts`), `ask_question` is created through the
  plugin's `name`/`description` options, and code blocks follow the theme (shiki
  light/dark pair). With 0.15.1: `ask_question` registers with `systemPrompt: false`
  instead of stripping the field, the declined sentence is the plugin's exported
  `ASK_USER_DECLINED`, and the provider's metadata is typed with core's exported
  `AparteAIProviderMetadata`. With 0.16.0: `estimateTokens` left the engine for
  `@aparte/plugin-compaction`, which takes `@aparte/engine`'s place in our
  dependencies — we now import nothing from the engine while still running its loop
  on every turn, since core depends on it. The wrapper renders `<aparte-elicitation>`
  itself, so ours is gone from the chat template. The library's default density moves
  up a step (radii 3px, font scale 1.08, buttons 24/32/40) and we take it as it comes:
  it aligns with the kits a chat is compared against.
- `package.json` filled in (name, licence, repository); Node 24.
- Repository documentation switched to English.
- The product name is spelled **Monaparté** (capital, accent) wherever it names the
  product — page title, metadata, manifest, social card, docs. Identifiers stay ASCII
  (`monaparte` package and database, `dist/monaparte`, `mon.apartejs.dev`).

## History before this changelog

- **2026-08-21** — Vision: `read_file(image)` through a hot-attached vision tower, tiling,
  describe language. Rename bonaparte → monaparte. GHCR + Coolify deployment, nginx
  hardening, SEO (head, social card, robots, sitemap, llms.txt).
- **2026-07-25** — Milestone 3: file registry, six tools, hot-swapped executors (pdf,
  xlsx/docx, sandbox), persisted artifacts with previews, weight versioning through
  `manifest.json`.
- **2026-07-24** — Milestone 2: PWA, ⌘K search, minimap, link guard, lazy KaTeX and
  Mermaid, mascot, Docker image. Milestone 1: chat, local model, Dexie persistence,
  three-step onboarding.
- **2026-07-23** — Framing.
