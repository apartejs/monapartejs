/**
 * Adaptateur ask_question : le contrat souffleurs émet
 * `{question, options: string[], multi_select, allow_other}` là où le plugin
 * @aparte/plugin-ask-question attend `{question, options: {title}[], multiple, allowOther}`.
 * Sans ce shim, un choix multi-sélection serait silencieusement traité en radio.
 */
import type { AparteToolHandler } from '@aparte/core';
import { askQuestionHandler, askQuestionTool } from '@aparte/plugin-ask-question';

export const souffleurAskQuestionTool = askQuestionTool;

export const souffleurAskQuestionHandler: AparteToolHandler = (call, signal) =>
  askQuestionHandler({ ...call, input: normalizeAskQuestionInput(call.input) }, signal);

export function normalizeAskQuestionInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const questions = input['questions'];
  if (!Array.isArray(questions)) return input;
  return {
    ...input,
    questions: questions.map((q) => {
      if (q === null || typeof q !== 'object') return q;
      const item = q as Record<string, unknown>;
      const options = Array.isArray(item['options'])
        ? (item['options'] as unknown[]).map((o) =>
            typeof o === 'string' ? { title: o } : o,
          )
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
