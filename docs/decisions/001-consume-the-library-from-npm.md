# ADR-001 — Consume `@aparte/*` from npm; Angular 19 standalone, no nx

- **Date**: 2026-07-23
- **Status**: accepted
- **Context**: Monaparté is the port of the former aimi app onto the aparté library. The
  library lives in a neighbouring monorepo; the temptation is to link it locally.
- **Decision**: the product consumes **only** the `@aparte/*` packages published on npm.
  Fresh Angular CLI scaffold (19.2, aligned with `@aparte/angular`'s peers), standalone,
  esbuild, strict TypeScript, no nx. Services are ported one by one as needed; the old
  app is not copied.
- **Consequences**: a library regression is reported and fixed in its own repository,
  never patched here. Every version bump is a PR validated in the browser. Angular only
  moves when the library's peers require it.
- **Evidence / references**: framing spec of 2026-07-23; apartejs `CLAUDE.md` ("the
  product lives in its own repository").
