import { ASSISTANT_NAME, SOUFFLEUR_TOOL_DEFS, SP_CORE_TEMPLATE } from './tool-defs';

/** Attached file reference, as serialized in the "Files available" block. */
export interface SouffleurFileRef {
  id: string;
  name: string;
  type: string;
}

/**
 * MEASURED, so as not to redo it: adding a sentence to the sp-chat body
 * asserting "the Files available files ARE readable" changes NOTHING.
 * A/B on the actually deployed model (aparte-repetitions/export/run_souffleur.py
 * --ab, injected graph + souffleur-chat adapter): on "Hello, what can you
 * do?" the answer is identical DOWN TO THE TOKEN, denial included. And on
 * concrete requests ("can you read my files?", "what can you tell me about
 * this image?", "can you analyze a document?") the model correctly calls
 * `read_file` — with AND without the sentence.
 *
 * The defect is therefore NOT "it thinks it can't read files": it's a
 * memorized self-presentation, triggered by the open inventory question
 * alone. The prompt has no leverage over it; the fix is on the data side
 * (aparte-repetitions), on the "asking it what it can do" shape. So we keep
 * the contract's body VERBATIM — 60 tokens per turn for zero effect wasn't an
 * acceptable trade.
 *
 * Assembles the caller's system prompt — exact training format:
 * sp-chat body + "\n\nList of tools: " + JSON + "\n\nFiles available: " + JSON.
 * Tools are emitted in the contract's order, regardless of activation order;
 * a name unknown to the contract is ignored. No active tool → no tools block
 * (behavior of the training rendering).
 */
export function buildSystemPrompt(
  enabledToolNames: readonly string[],
  files: readonly SouffleurFileRef[] = [],
  assistantName: string = ASSISTANT_NAME,
): string {
  const enabled = new Set(enabledToolNames);
  const tools = SOUFFLEUR_TOOL_DEFS.filter((t) => enabled.has(t.name));

  let s = SP_CORE_TEMPLATE.replace('{{assistant}}', assistantName);
  if (tools.length) {
    s += '\n\nList of tools: ' + JSON.stringify(tools);
  }
  if (files.length) {
    s +=
      '\n\nFiles available: ' +
      JSON.stringify(files.map(({ id, name, type }) => ({ id, name, type })));
  }
  return s;
}
