# ADR-009 — The repository is in English; model-facing text keeps the contract's language

- **Date**: 2026-08-28 (supersedes the earlier "French for humans" practice)
- **Status**: accepted
- **Context**: the project started in French — interface, comments, commits, docs — while
  the rest of the `apartejs` organisation is in English. A public repository with two
  languages is harder to read and to contribute to than one with a single language.
- **Decision**: the repository is in English: documentation, commit messages, code
  comments, identifiers, issue and PR text, the static page (`index.html`, manifest,
  social card). Two exceptions: text meant for the **model** (system prompt, tool
  descriptions, executor prompts) stays in the language of the training contract,
  verbatim; **UI strings** are localised in `fr` and `en` and both are maintained.
- **Consequences**: French comments that predate this decision are legacy and are
  translated when a file is touched, never in a drive-by sweep. A tool result in English
  handed to a French-trained model is a data problem (friction F6), not a reason to
  translate code.
- **Evidence / references**: Paul's decision of 2026-08-28; apartejs `CONTRIBUTING.md`.
