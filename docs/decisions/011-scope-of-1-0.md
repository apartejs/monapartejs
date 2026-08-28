# ADR-011 — Scope of 1.0: prove what exists, do not extend it

- **Date**: 2026-08-28
- **Status**: proposed
- **Context**: at the project's restart, the whole planned feature scope is delivered
  (milestones 1–3, milestone 4 in part), but nothing is proven by interface tests or an
  automated journey, and the public repository had neither licence nor governance.
- **Decision**: 1.0 contains no new feature. It makes the existing product proven
  (component tests, Playwright journey with a mocked model, recorded browser validation),
  faithful to the contract, and presentable (error states, complete i18n, visible
  version). Memory, document search, plugin extraction and the Angular bump come after.
- **Consequences**: a feature request on the way to 1.0 goes into an issue labelled
  `after-1.0`, not into a branch.
- **Evidence / references**: `ROADMAP.md`.
