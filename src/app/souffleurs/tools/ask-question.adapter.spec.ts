/**
 * The tool turn that follows `ask_question` must have the dataset's shape
 * (`{ok, type, answers:[{value}|{values}]}`), and the displayed receipt must recover
 * the prose that the plugin knows how to render. The two conversions are inverses
 * of each other — that's what's verified here.
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

describe('toTrainingResult — plugin prose → dataset JSON', () => {
  it('one question, one value', () => {
    expect(toTrainingResult('pdf', single)).toEqual({
      ok: true,
      type: 'ask_question',
      answers: [{ value: 'pdf' }],
    });
  });

  it('one multi question → values', () => {
    expect(toTrainingResult('Nom, Prix', singleMulti).answers).toEqual([
      { values: ['Nom', 'Prix'] },
    ]);
  });

  it('several questions: one "question → answer" line each', () => {
    expect(toTrainingResult('Format ? → xlsx\nColonnes ? → Nom, Prix', two).answers).toEqual([
      { value: 'xlsx' },
      { values: ['Nom', 'Prix'] },
    ]);
  });

  it('decline → ok:false, no answers', () => {
    expect(toTrainingResult(PLUGIN_DECLINED_TEXT, single)).toEqual({
      ok: false,
      type: 'ask_question',
      error: 'declined',
    });
  });
});

describe('askQuestionReceiptText — JSON → prose, exact inverse', () => {
  it.each([
    ['pdf', single],
    ['Nom, Prix', singleMulti],
    ['Format ? → xlsx\nColonnes ? → Nom, Prix', two],
    [PLUGIN_DECLINED_TEXT, single],
  ])('round-trip on %j', (plain, input) => {
    const json = JSON.stringify(toTrainingResult(plain, input));
    expect(askQuestionReceiptText(json, input)).toBe(plain);
  });

  it('lets a pre-this-format result pass through (legacy)', () => {
    expect(askQuestionReceiptText('pdf', single)).toBe('pdf');
    expect(askQuestionReceiptText(undefined, single)).toBeUndefined();
  });
});

describe('souffleurAskQuestionHandler', () => {
  it('returns the dataset JSON to the model, not the plugin prose', async () => {
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

  it('keeps the contract name and strips the plugin systemPrompt', () => {
    expect(souffleurAskQuestionTool.name).toBe('ask_question');
    expect('systemPrompt' in souffleurAskQuestionTool).toBe(false);
  });
});
