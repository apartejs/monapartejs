/**
 * Adaptateur ask_question : deux écarts avec le plugin, pas un.
 *
 * 1. LE NOM. Depuis aparté 0.8 le plugin s'appelle `@aparte/plugin-ask-user` et
 *    son outil `ask_user` (alignement sur la convention d'écosystème). Le
 *    contrat d'entraînement des souffleurs, lui, dit `ask_question` — c'est le
 *    nom que le modèle émet et celui de `SOUFFLEUR_TOOL_DEFS`. On réétiquette
 *    donc l'outil du plugin : le renommer côté lib ne renomme pas des poids.
 * 2. LA FORME. Le contrat émet `{question, options: string[], multi_select,
 *    allow_other}` là où le plugin attend `{question, options: {title}[],
 *    multiple, allowOther}`. Sans ce shim, une multi-sélection serait
 *    silencieusement traitée en radio.
 *
 * Seul le NOM compte ici : c'est la clé de dispatch de `getToolHandler`. Le
 * schéma et la prose du plugin, eux, ne doivent pas atteindre le modèle — et
 * depuis aparté 0.13 (`a453df1`) ce n'est plus théorique : `AparteTool.systemPrompt`
 * est réellement envoyé, joint aux autres et poussé comme message système. Celui
 * du plugin annonce « You have access to the ask_user tool », soit un nom que le
 * contrat ne connaît pas, en anglais hors contrat d'entraînement.
 *
 * Notre `buildWirePrompt` jette les messages `role: 'system'` de l'historique
 * (`case 'system': break;`), donc rien n'arrive au modèle aujourd'hui. On retire
 * quand même les deux champs plutôt que de dépendre de ça : le jour où le
 * constructeur de prompt honorerait un rôle système, la régression serait
 * silencieuse et le modèle appellerait un outil qui n'existe pas.
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { askUserHandler, createAskUserTool } from '@aparte/plugin-ask-user';

/** Nom du contrat souffleurs, pas celui du plugin. */
export const SOUFFLEUR_ASK_QUESTION_TOOL_NAME = 'ask_question';

const { systemPrompt: _pluginSystemPrompt, ...askUserToolShape } = createAskUserTool();

export const souffleurAskQuestionTool: AparteTool = {
  ...askUserToolShape,
  name: SOUFFLEUR_ASK_QUESTION_TOOL_NAME,
  // Reprend le vocabulaire du contrat, pas celui du plugin.
  description: "Pose une question à l'utilisateur avec des options structurées.",
};

export const souffleurAskQuestionHandler: AparteToolHandler = (call, signal) =>
  askUserHandler({ ...call, input: normalizeAskQuestionInput(call.input) }, signal);

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
