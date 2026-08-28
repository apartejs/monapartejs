# ADR-007 — The build runs on GitHub; Coolify only pulls the image

- **Date**: 2026-08-21
- **Status**: accepted
- **Context**: a production Angular build needs several GB of memory; the server (N100)
  hosts fifteen other containers. Two setups were tried and measured broken: a Dockerfile
  `FROM ghcr.io/…:main` (BuildKit cache, image never refreshed) and a compose without
  `pull_policy` (previous image reused, three deployments in a row).
- **Decision**: GitHub Actions verifies, builds and publishes
  `ghcr.io/apartejs/monapartejs:main` (+ `sha-…`), then calls the Coolify webhook. On the
  Coolify side: a Docker Compose resource, a compose without a `build:` key,
  `pull_policy: always`. Never a git "on push" webhook (it would pull the previous image).
- **Consequences**: a green deployment does not guarantee freshness — check
  `last-modified`. Rollback = replace `:main` with a `sha-…` tag.
- **Evidence / references**: `docs/DEPLOY-COOLIFY.md`; commits `80f1d45`, `ae8ed95`.
