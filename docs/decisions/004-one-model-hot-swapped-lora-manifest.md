# ADR-004 — One model, hot-swapped LoRA adapters, versioned by `manifest.json`

- **Date**: 2026-07-25
- **Status**: accepted
- **Context**: several specialisations (chat, pdf, xlsx/docx, sandbox, vision) without
  multiplying downloads or touching code every time weights are published.
- **Decision**: one frozen LFM2.5-VL-1.6B base (lab ADR-001), int8 LoRA adapters swapped
  at call time through `session_options.externalData`, a vision tower attached on the
  first image. The HF repository's `manifest.json` (served `no-store`) is the source of
  truth: immutable files with versioned names, so an update is a natural cache miss, with
  no purge. Publishing weights = bumping the manifest, zero change here.
- **Consequences**: no hard-coded file path in the app; onboarding reads sizes from the
  manifest; the worker is keyed by adapter file. Offline fallback on the last known
  manifest.
- **Evidence / references**: `HANDOFF-versioning-souffleurs.md` (lab);
  `src/app/souffleurs/manifest.ts`; commit `f5055f0`.
