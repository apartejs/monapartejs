# ADR-002 — Persistence lives in the app

- **Date**: 2026-07-23
- **Status**: accepted
- **Context**: the library is "a library, not an app" and ships no persistence. aimi had a
  complete IndexedDB adapter.
- **Decision**: `src/app/storage/` carries an `AparteStorageAdapter` on Dexie (schema
  identical to aimi v2: conversations, messages, attachments, artifacts, settings) plus a
  separate `souffleurFiles` table — the ids the model copies must outlive conversations.
  Export/import as one versioned JSON.
- **Consequences**: the export format is a contract (the old `bonaparte-full-export`
  kind stays accepted). Natural candidate for extraction into
  `@aparte/plugin-storage-indexeddb` after 1.0.
- **Evidence / references**: `src/app/storage/db.ts`, `export-import.ts`; commit `50de2bd`.
