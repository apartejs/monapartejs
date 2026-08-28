# ADR-008 — Nothing merges without browser validation; `main` deploys, so work happens on branches

- **Date**: 2026-07-25 (branches: 2026-08-21)
- **Status**: accepted
- **Context**: the `/debug/artefacts` harness had hidden a bug (styles injected by hand)
  that only the real path showed. And every push to `main` builds and deploys — a merge
  done "because the go was given" cost a full cycle.
- **Decision**: an interface change is validated in the browser before merge, and the
  commit or PR says what was seen. All work happens on a branch; merging into `main` is a
  decision distinct from the "go" on the work.
- **Consequences**: the PR template asks for it. Step 3 of the roadmap makes the rule
  mechanical (component tests, Playwright journey with a mocked model).
- **Evidence / references**: journal of 2026-07-25; commit `ea5e430`.
