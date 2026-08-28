import { describe, expect, it } from 'vitest';
import { parsePythonicOutput, UNPARSEABLE } from './pythonic-parser';

const wrap = (inner: string) => `<|tool_call_start|>${inner}<|tool_call_end|>`;

describe('parsePythonicOutput', () => {
  it('parse un appel simple avec string', () => {
    const out = parsePythonicOutput(wrap('[read_file(file_id="file_abc_1")]'));
    expect(out.calls).toEqual([{ name: 'read_file', args: { file_id: 'file_abc_1' } }]);
    expect(out.text).toBe('');
  });

  it('préserve le texte autour du bloc', () => {
    const out = parsePythonicOutput(
      'Je consulte votre fichier.\n' + wrap('[read_file(file_id="f1")]'),
    );
    expect(out.text).toBe('Je consulte votre fichier.');
    expect(out.calls).toHaveLength(1);
  });

  it('coupe à <|im_end|> et ignore ce qui suit', () => {
    const out = parsePythonicOutput('Bonjour.\n<|im_end|>\n<|im_start|>user\npollution');
    expect(out.text).toBe('Bonjour.');
    expect(out.calls).toEqual([]);
  });

  it('retire les blocs <think>', () => {
    const out = parsePythonicOutput('<think>réflexion interne</think>Réponse.');
    expect(out.text).toBe('Réponse.');
  });

  it('parse plusieurs appels dans un même bloc', () => {
    const out = parsePythonicOutput(wrap('[remember(fact="aime le thé"), compute(task="2+2")]'));
    expect(out.calls).toEqual([
      { name: 'remember', args: { fact: 'aime le thé' } },
      { name: 'compute', args: { task: '2+2' } },
    ]);
  });

  it('parse listes, nombres, booléens Python et None', () => {
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

  it('tolère les minuscules JS true/false/null', () => {
    const out = parsePythonicOutput(wrap('[f(a=true, b=false, c=null)]'));
    expect(out.calls[0].args).toEqual({ a: true, b: false, c: null });
  });

  it('parse un dict imbriqué valide', () => {
    const out = parsePythonicOutput(
      wrap('[transform_file(file_id="f1", target="png", options={"width": 800, "keep": True})]'),
    );
    expect(out.calls[0].args['options']).toEqual({ width: 800, keep: true });
  });

  it('tolère le pseudo-python {cle="val"} dans un dict', () => {
    const out = parsePythonicOutput(
      wrap('[transform_file(file_id="f1", target="png", options={width=800})]'),
    );
    expect(out.calls[0].args['options']).toEqual({ width: 800 });
  });

  it('parse les questions ask_question (liste de dicts)', () => {
    const out = parsePythonicOutput(
      wrap(
        '[ask_question(questions=[{"question": "Quel format ?", "options": ["pdf", "xlsx"], "multi_select": False}])]',
      ),
    );
    expect(out.calls[0].args['questions']).toEqual([
      { question: 'Quel format ?', options: ['pdf', 'xlsx'], multi_select: false },
    ]);
  });

  it('gère les échappements dans les strings', () => {
    const out = parsePythonicOutput(wrap('[compute(task="ligne1\\nligne2 \\"citée\\"")]'));
    expect(out.calls[0].args['task']).toBe('ligne1\nligne2 "citée"');
  });

  it('accepte un appel nu sans crochets', () => {
    const out = parsePythonicOutput(wrap('compute(task="2+2")'));
    expect(out.calls).toEqual([{ name: 'compute', args: { task: '2+2' } }]);
  });

  it('bloc imparsable → __unparseable__ avec le brut, sans crash', () => {
    const out = parsePythonicOutput(wrap('[write_file(kind=***garbage'));
    expect(out.calls).toEqual([
      { name: UNPARSEABLE, args: { raw: '[write_file(kind=***garbage' } },
    ]);
  });

  it('sans bloc : texte seul', () => {
    const out = parsePythonicOutput('Avec plaisir ! Autre chose ?');
    expect(out).toEqual({ text: 'Avec plaisir ! Autre chose ?', calls: [] });
  });
});
