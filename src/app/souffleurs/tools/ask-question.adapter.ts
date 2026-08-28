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

/**
 * Chaîne que le plugin renvoie quand l'utilisateur ferme le panneau sans
 * répondre. Le plugin ne l'exporte pas depuis son index (`ASK_USER_DECLINED`,
 * interne à `ask-user-*.js`) ; on la recopie. À CONTRÔLER à chaque montée du
 * plugin : si elle change, un refus serait pris pour une réponse « value ».
 */
export const PLUGIN_DECLINED_TEXT = 'The user declined to answer.';

/** Une réponse par question, forme du dataset : `{value}` ou `{values}` en multi. */
export type AskQuestionAnswer = { value: string } | { values: string[] };

export interface AskQuestionResult {
  ok: boolean;
  type: 'ask_question';
  answers?: AskQuestionAnswer[];
  error?: string;
}

/**
 * 3. L'OBSERVATION. À l'entraînement, le tour `tool` qui suit `ask_question` est
 *    le JSON `{ok:true, type:'ask_question', answers:[{value}|{values}]}` — c'est
 *    ce que pousse `browser/app/app.js` du lab (`onAskQuestionSubmit`), et ce que
 *    le modèle a appris à lire (HANDOFF-fixes-bonaparte §4). Le plugin, lui,
 *    répond en prose (« a, b » ou « question → réponse » par ligne). On garde le
 *    plugin pour le panneau et on ne convertit que le tour d'outil, dans les
 *    deux sens : vers le JSON pour le modèle ici, vers la prose pour le reçu
 *    affiché dans `askQuestionReceiptText`.
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

/** Sépare une liste jointe par le plugin (`formatAnswer` : `values.join(', ')`). */
const splitValues = (s: string): string[] =>
  s
    .split(', ')
    .map((v) => v.trim())
    .filter(Boolean);

/**
 * Prose du plugin → JSON du dataset. Le plugin joint les valeurs d'une
 * multi-sélection par « , » : une valeur qui contiendrait elle-même « , »
 * serait coupée — assumé, les options viennent du modèle et sont courtes.
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
 * JSON du dataset → prose du plugin, pour `buildReceipt` (qui relit
 * `segment.result` au format de son propre handler). Un résultat qui n'est pas
 * notre JSON (historique d'avant ce changement) est rendu tel quel.
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
