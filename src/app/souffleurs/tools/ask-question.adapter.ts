/**
 * ask_question adapter: two mismatches with the plugin, not one.
 *
 * 1. THE NAME. Since aparté 0.8 the plugin is called `@aparte/plugin-ask-user` and
 *    its tool `ask_user` (alignment on the ecosystem convention). The souffleurs
 *    training contract, on the other hand, says `ask_question` — that's the
 *    name the model emits and the one in `SOUFFLEUR_TOOL_DEFS`. So we relabel
 *    the plugin's tool: renaming it on the lib side doesn't rename weights.
 * 2. THE SHAPE. The contract emits `{question, options: string[], multi_select,
 *    allow_other}` where the plugin expects `{question, options: {title}[],
 *    multiple, allowOther}`. Without this shim, a multi-selection would be
 *    silently treated as a radio button.
 *
 * Only the NAME matters here: it's the dispatch key for `getToolHandler`. The
 * plugin's schema and prose, on the other hand, must not reach the model — and
 * since aparté 0.13 (`a453df1`) that's no longer theoretical: `AparteTool.systemPrompt`
 * is actually sent, joined with the others and pushed as a system message. The
 * plugin's announces "You have access to the ask_user tool", i.e. a name the
 * contract doesn't know, in English outside the training contract.
 *
 * Our `buildWirePrompt` drops `role: 'system'` messages from the history
 * (`case 'system': break;`), so nothing reaches the model today. We still remove
 * both fields rather than depend on that: the day the prompt builder honors a
 * system role, the regression would be silent and the model would call a tool
 * that doesn't exist.
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { askUserHandler, createAskUserTool } from '@aparte/plugin-ask-user';

/** Name from the souffleurs contract, not the plugin's. */
export const SOUFFLEUR_ASK_QUESTION_TOOL_NAME = 'ask_question';

const { systemPrompt: _pluginSystemPrompt, ...askUserToolShape } = createAskUserTool();

export const souffleurAskQuestionTool: AparteTool = {
  ...askUserToolShape,
  name: SOUFFLEUR_ASK_QUESTION_TOOL_NAME,
  // Uses the contract's vocabulary, not the plugin's.
  description: "Pose une question à l'utilisateur avec des options structurées.",
};

/**
 * String the plugin returns when the user closes the panel without
 * answering. The plugin doesn't export it from its index (`ASK_USER_DECLINED`,
 * internal to `ask-user-*.js`); we copy it here. To CHECK on every plugin
 * upgrade: if it changes, a decline would be mistaken for a "value" answer.
 */
export const PLUGIN_DECLINED_TEXT = 'The user declined to answer.';

/** One answer per question, dataset shape: `{value}` or `{values}` for multi. */
export type AskQuestionAnswer = { value: string } | { values: string[] };

export interface AskQuestionResult {
  ok: boolean;
  type: 'ask_question';
  answers?: AskQuestionAnswer[];
  error?: string;
}

/**
 * 3. THE OBSERVATION. During training, the `tool` turn that follows `ask_question`
 *    is the JSON `{ok:true, type:'ask_question', answers:[{value}|{values}]}` — that's
 *    what the lab's `browser/app/app.js` pushes (`onAskQuestionSubmit`), and what
 *    the model learned to read (HANDOFF-fixes-bonaparte §4). The plugin, on the
 *    other hand, answers in prose ("a, b" or "question → answer" per line). We
 *    keep the plugin for the panel and only convert the tool turn, in both
 *    directions: to JSON for the model here, to prose for the receipt
 *    displayed in `askQuestionReceiptText`.
 */
export const souffleurAskQuestionHandler: AparteToolHandler = async (call, signal) => {
  const input = normalizeAskQuestionInput(call.input);
  const plain = await askUserHandler({ ...call, input }, signal);
  const result = toTrainingResult(String(plain.content ?? ''), input);
  return { ...plain, content: JSON.stringify(result) };
};

interface QuestionShape {
  question: string;
  multiple: boolean;
}

function questionsOf(input: Record<string, unknown>): QuestionShape[] {
  const raw = input['questions'];
  const list = Array.isArray(raw) && raw.length > 0 ? raw : [input];
  return list.map((q) => {
    const item = (q ?? {}) as Record<string, unknown>;
    return {
      question: String(item['question'] ?? ''),
      multiple: Boolean(item['multiple'] ?? item['multi_select'] ?? false),
    };
  });
}

/** Splits a list joined by the plugin (`formatAnswer`: `values.join(', ')`). */
const splitValues = (s: string): string[] =>
  s
    .split(', ')
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Plugin prose → dataset JSON. The plugin joins a multi-selection's values
 * with ", ": a value that itself contained "," would be cut — accepted,
 * the options come from the model and are short.
 */
export function toTrainingResult(plain: string, input: Record<string, unknown>): AskQuestionResult {
  const text = plain.trim();
  if (text === PLUGIN_DECLINED_TEXT) {
    return { ok: false, type: 'ask_question', error: 'declined' };
  }
  const questions = questionsOf(input);
  const one = (q: QuestionShape, s: string): AskQuestionAnswer =>
    q.multiple ? { values: splitValues(s) } : { value: s.trim() };

  if (questions.length <= 1) {
    const q = questions[0] ?? { question: '', multiple: false };
    return { ok: true, type: 'ask_question', answers: [one(q, text)] };
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const answers = questions.map((q, i) => {
    const line = lines[i] ?? '';
    const sep = line.indexOf(' → ');
    return one(q, sep === -1 ? line : line.slice(sep + 3));
  });
  return { ok: true, type: 'ask_question', answers };
}

/**
 * Dataset JSON → plugin prose, for `buildReceipt` (which reads back
 * `segment.result` in its own handler's format). A result that isn't our
 * JSON (history from before this change) is rendered as-is.
 */
export function askQuestionReceiptText(
  result: string | undefined,
  input: Record<string, unknown>,
): string | undefined {
  if (!result) return result;
  let parsed: AskQuestionResult;
  try {
    parsed = JSON.parse(result) as AskQuestionResult;
  } catch {
    return result;
  }
  if (!parsed || parsed.type !== 'ask_question') return result;
  if (!parsed.ok || !parsed.answers) return PLUGIN_DECLINED_TEXT;
  const questions = questionsOf(input);
  const text = (a: AskQuestionAnswer) => ('values' in a ? a.values.join(', ') : a.value);
  if (questions.length <= 1) return text(parsed.answers[0] ?? { value: '' });
  return questions
    .map((q, i) => `${q.question} → ${text(parsed.answers![i] ?? { value: '' })}`)
    .join('\n');
}

export function normalizeAskQuestionInput(input: Record<string, unknown>): Record<string, unknown> {
  const questions = input['questions'];
  if (!Array.isArray(questions)) return input;
  return {
    ...input,
    questions: questions.map((q) => {
      if (q === null || typeof q !== 'object') return q;
      const item = q as Record<string, unknown>;
      const options = Array.isArray(item['options'])
        ? (item['options'] as unknown[]).map((o) => (typeof o === 'string' ? { title: o } : o))
        : item['options'];
      return {
        ...item,
        options,
        multiple: item['multiple'] ?? item['multi_select'] ?? false,
        allowOther: item['allowOther'] ?? item['allow_other'] ?? true,
      };
    }),
  };
}
