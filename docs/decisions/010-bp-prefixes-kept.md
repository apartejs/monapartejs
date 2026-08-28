# ADR-010 — The `bp-` / `bp.` prefixes are kept, not migrated

- **Date**: 2026-08-28
- **Status**: proposed
- **Context**: the project was called bonaparte until 2026-08-21. Component selectors
  (`bp-…`) and `localStorage` keys (`bp.debug`, `bp.souffleurs.seen`, `bp.reminders`…)
  still carry that prefix.
- **Decision**: keep them. Migrating `localStorage` keys imposes backward compatibility
  for zero user benefit; renaming selectors is a massive diff with no value. `bp` now
  reads as a plain namespace.
- **Consequences**: `CONTRIBUTING.md` says so; a new component or key keeps the same
  prefix, for consistency.
- **Evidence / references**: commit `aec659c` (rename); `6610f59` (fallout on saved
  exports — the real cost of renaming keys).
