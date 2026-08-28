/**
 * Le tour d'outil qui suit `ask_question` doit avoir la forme du dataset
 * (`{ok, type, answers:[{value}|{values}]}`), et le reçu affiché doit retrouver
 * la prose que le plugin sait rendre. Les deux conversions sont inverses l'une
 * de l'autre — c'est ce qui est vérifié ici.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@aparte/plugin-ask-user', () => ({
  askUserHandler: vi.fn(),
  createAskUserTool: () => ({
    name: 'ask_user',
    description: 'x',
    inputSchema: { type: 'object' },
    systemPrompt: 'You have access to the ask_user tool',
  }),
}));

import { askUserHandler } from '@aparte/plugin-ask-user';
import {
  PLUGIN_DECLINED_TEXT,
  askQuestionReceiptText,
  souffleurAskQuestionHandler,
  souffleurAskQuestionTool,
  toTrainingResult,
} from './ask-question.adapter';

const single = { questions: [{ question: 'Quel format ?', options: ['xlsx', 'pdf'] }] };
const singleMulti = {
  questions: [{ question: 'Quelles colonnes ?', options: ['Nom', 'Prix'], multi_select: true }],
};
const two = {
  questions: [
    { question: 'Format ?', options: ['xlsx', 'pdf'] },
    { question: 'Colonnes ?', options: ['Nom', 'Prix'], multi_select: true },
  ],
};

describe('toTrainingResult — prose du plugin → JSON du dataset', () => {
  it('une question, une valeur', () => {
    expect(toTrainingResult('pdf', single)).toEqual({
      ok: true,
      type: 'ask_question',
      answers: [{ value: 'pdf' }],
    });
  });

  it('une question multi → values', () => {
    expect(toTrainingResult('Nom, Prix', singleMulti).answers).toEqual([
      { values: ['Nom', 'Prix'] },
    ]);
  });

  it('plusieurs questions : une ligne « question → réponse » chacune', () => {
    expect(toTrainingResult('Format ? → xlsx\nColonnes ? → Nom, Prix', two).answers).toEqual([
      { value: 'xlsx' },
      { values: ['Nom', 'Prix'] },
    ]);
  });

  it('refus → ok:false, sans answers', () => {
    expect(toTrainingResult(PLUGIN_DECLINED_TEXT, single)).toEqual({
      ok: false,
      type: 'ask_question',
      error: 'declined',
    });
  });
});

describe('askQuestionReceiptText — JSON → prose, inverse exacte', () => {
  it.each([
    ['pdf', single],
    ['Nom, Prix', singleMulti],
    ['Format ? → xlsx\nColonnes ? → Nom, Prix', two],
    [PLUGIN_DECLINED_TEXT, single],
  ])('aller-retour sur %j', (plain, input) => {
    const json = JSON.stringify(toTrainingResult(plain, input));
    expect(askQuestionReceiptText(json, input)).toBe(plain);
  });

  it("laisse passer un résultat d'avant ce format (historique)", () => {
    expect(askQuestionReceiptText('pdf', single)).toBe('pdf');
    expect(askQuestionReceiptText(undefined, single)).toBeUndefined();
  });
});

describe('souffleurAskQuestionHandler', () => {
  it('renvoie le JSON du dataset au modèle, pas la prose du plugin', async () => {
    vi.mocked(askUserHandler).mockResolvedValue({ toolCallId: 'c1', content: 'pdf' });
    const out = await souffleurAskQuestionHandler(
      { id: 'c1', name: 'ask_question', input: single },
      new AbortController().signal,
    );
    expect(JSON.parse(out.content)).toEqual({
      ok: true,
      type: 'ask_question',
      answers: [{ value: 'pdf' }],
    });
  });

  it('garde le nom du contrat et retire le systemPrompt du plugin', () => {
    expect(souffleurAskQuestionTool.name).toBe('ask_question');
    expect('systemPrompt' in souffleurAskQuestionTool).toBe(false);
  });
});
