# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [SemVer](https://semver.org/). Until 1.0 is tagged, the deployed version is `main`.

## [Unreleased]

### Added
- MIT licence, contributing guide, code of conduct, security policy, roadmap, decision
  records (`docs/decisions/`), issue and PR templates, Dependabot.
- ESLint (angular-eslint) and Prettier; `pnpm verify` now runs lint and format checks
  before types and tests.

### Fixed
- Executors: the task is prefixed with `intent: ` as in 100 % of the training examples —
  every file generation was going out of distribution.
- PDF sandbox: `autoTable` exposed as a global in addition to `doc.autoTable`; the prompt
  advertised both forms, only one worked.
- `ask_question`: the observation returned to the model has the dataset's shape
  (`{ok, type, answers}`); the displayed receipt is rebuilt from that JSON.

### Changed
- `@aparte/*` 0.13.0 → 0.13.1; `package.json` filled in (name, licence, repository);
  Node 24.
- Repository documentation switched to English.

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
