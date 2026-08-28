# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [SemVer](https://semver.org/). Until 1.0 is tagged, the deployed version is `main`.

## [Unreleased]

### Added
- Monaparté has its own colour and its own mark (ADR-012): Angular's
  magenta-violet as the interface accent, and the mascot drawn at home — a closed
  house, no door, no window, the light only ever inside. The house wraps the home
  screen mascot, the corner one and the sidebar wordmark, and it is the PWA icon and
  the social card. The favicon keeps the bare face — at 16 px the walls and the face
  fight for the same pixels — and says the state through its colour.
- MIT licence, contributing guide, code of conduct, security policy, roadmap, decision
  records (`docs/decisions/`), issue and PR templates, Dependabot.
- ESLint (angular-eslint) and Prettier; `pnpm verify` now runs lint and format checks
  before types and tests.
- `pnpm typecheck` runs `ngc` instead of `tsc`, so Angular templates are checked too: a
  binding to a missing property, or an input given the wrong type, used to compile clean
  and only fail at `ng build`.

### Fixed
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
  `AparteAIProviderMetadata`.
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
