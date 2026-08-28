import { describe, expect, it } from 'vitest';
import { parsePythonicOutput, UNPARSEABLE } from './pythonic-parser';

const wrap = (inner: string) => `<|tool_call_start|>${inner}<|tool_call_end|>`;

describe('parsePythonicOutput', () => {
  it('parses a simple call with a string', () => {
    const out = parsePythonicOutput(wrap('[read_file(file_id="file_abc_1")]'));
    expect(out.calls).toEqual([{ name: 'read_file', args: { file_id: 'file_abc_1' } }]);
    expect(out.text).toBe('');
  });

  it('preserves the text around the block', () => {
    const out = parsePythonicOutput(
      'Je consulte votre fichier.\n' + wrap('[read_file(file_id="f1")]'),
    );
    expect(out.text).toBe('Je consulte votre fichier.');
    expect(out.calls).toHaveLength(1);
  });

  it('cuts at <|im_end|> and ignores what follows', () => {
    const out = parsePythonicOutput('Bonjour.\n<|im_end|>\n<|im_start|>user\npollution');
    expect(out.text).toBe('Bonjour.');
    expect(out.calls).toEqual([]);
  });

  it('strips <think> blocks', () => {
    const out = parsePythonicOutput('<think>réflexion interne</think>Réponse.');
    expect(out.text).toBe('Réponse.');
  });

  it('parses several calls in the same block', () => {
    const out = parsePythonicOutput(wrap('[remember(fact="aime le thé"), compute(task="2+2")]'));
    expect(out.calls).toEqual([
      { name: 'remember', args: { fact: 'aime le thé' } },
      { name: 'compute', args: { task: '2+2' } },
    ]);
  });

  it('parses lists, numbers, Python booleans and None', () => {
    const out = parsePythonicOutput(
      wrap(
        '[write_file(kind="xlsx", task="t", file_ids=["a", "b"], count=3, ratio=1.5, force=True, extra=None)]',
      ),
    );
    expect(out.calls[0].args).toEqual({
      kind: 'xlsx',
      task: 't',
      file_ids: ['a', 'b'],
      count: 3,
      ratio: 1.5,
      force: true,
      extra: null,
    });
  });

  it('tolerates lowercase JS true/false/null', () => {
    const out = parsePythonicOutput(wrap('[f(a=true, b=false, c=null)]'));
    expect(out.calls[0].args).toEqual({ a: true, b: false, c: null });
  });

  it('parses a valid nested dict', () => {
    const out = parsePythonicOutput(
      wrap('[transform_file(file_id="f1", target="png", options={"width": 800, "keep": True})]'),
    );
    expect(out.calls[0].args['options']).toEqual({ width: 800, keep: true });
  });

  it('tolerates pseudo-python {key="val"} inside a dict', () => {
    const out = parsePythonicOutput(
      wrap('[transform_file(file_id="f1", target="png", options={width=800})]'),
    );
    expect(out.calls[0].args['options']).toEqual({ width: 800 });
  });

  it('parses ask_question questions (list of dicts)', () => {
    const out = parsePythonicOutput(
      wrap(
        '[ask_question(questions=[{"question": "Quel format ?", "options": ["pdf", "xlsx"], "multi_select": False}])]',
      ),
    );
    expect(out.calls[0].args['questions']).toEqual([
      { question: 'Quel format ?', options: ['pdf', 'xlsx'], multi_select: false },
    ]);
  });

  it('handles escapes inside strings', () => {
    const out = parsePythonicOutput(wrap('[compute(task="ligne1\\nligne2 \\"citée\\"")]'));
    expect(out.calls[0].args['task']).toBe('ligne1\nligne2 "citée"');
  });

  it('accepts a bare call without brackets', () => {
    const out = parsePythonicOutput(wrap('compute(task="2+2")'));
    expect(out.calls).toEqual([{ name: 'compute', args: { task: '2+2' } }]);
  });

  it('unparseable block → __unparseable__ with the raw text, no crash', () => {
    const out = parsePythonicOutput(wrap('[write_file(kind=***garbage'));
    expect(out.calls).toEqual([
      { name: UNPARSEABLE, args: { raw: '[write_file(kind=***garbage' } },
    ]);
  });

  it('no block: text only', () => {
    const out = parsePythonicOutput('Avec plaisir ! Autre chose ?');
    expect(out).toEqual({ text: 'Avec plaisir ! Autre chose ?', calls: [] });
  });
});
