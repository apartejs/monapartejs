# ADR-005 — Routing lives in the model; tools without data stay out of the list

- **Date**: 2026-07-23
- **Status**: accepted
- **Context**: aimi had an application-side "orchestrator". The aparté model is trained
  to decide on tool calls itself.
- **Decision**: `souffleur-chat` decides and emits the calls; the app only parses and
  executes. `search_knowledge` and `remember` are **not** registered: the first has no
  corpus and the model was only trained on it negatively, the second has no positive
  example. A tool without data is a decoy.
- **Consequences**: the library's activation list acts as a filter over the contract; the
  prompt only lists active tools. Re-enabling a tool = a data pass in the lab first, then
  one line here.
- **Evidence / references**: spec of 2026-07-23; `FRICTIONS-MODELE.local.md` F4;
  `src/app/core/aparte.config.ts`.
