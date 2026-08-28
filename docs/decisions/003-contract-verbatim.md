# ADR-003 — The training contract is ported verbatim and regenerated, never rephrased

- **Date**: 2026-07-24 (reinforced 2026-08-21 and 2026-08-28)
- **Status**: accepted
- **Context**: the model learned an exact format — a three-block system prompt, tool
  descriptions, the conversation template, the executors' user turn. Any deviation puts it
  out of distribution, with no error message.
- **Decision**: `wire/tool-defs.ts` is **generated** from the lab's contract (byte for
  byte), `wire/system-prompt.ts` adds nothing to the body, `executors/executor-prompts.ts`
  copies the lab's runtime prompts, the template is rendered by hand (never
  `apply_chat_template`), tool calls are parsed by AST. When the contract moves, we
  regenerate. Gaps reported by the lab (`intent: ` prefix, `ask_question` observation as
  JSON, `autoTable` global) are closed on the app side.
- **Consequences**: the model is not "fixed" through the prompt. Measured: one sentence
  added to the body changes nothing, token for token (comment in `system-prompt.ts`). A
  model friction is logged with its measurement and fixed in training.
- **Evidence / references**: `HANDOFF-fixes-bonaparte.md` (lab, 2026-07-26); commits
  `cbf083e`, `f3fe172`, `2edbb74`.
