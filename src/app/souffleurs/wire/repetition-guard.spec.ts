import { describe, expect, it } from 'vitest';
import { RepetitionGuard } from './repetition-guard';

const LOOP = "Je vais mettre 0 pour le total HT si c'est la première ligne de";

describe('RepetitionGuard', () => {
  it('trips on the fourth identical consecutive line, fed token by token', () => {
    const g = new RepetitionGuard();
    const text = Array(4).fill(LOOP).join('\n') + '\n';
    for (const ch of text) g.push(ch);
    expect(g.tripped).toBe(true);
  });

  it('does not trip on three repeats', () => {
    const g = new RepetitionGuard();
    g.push(Array(3).fill(LOOP).join('\n') + '\n');
    expect(g.tripped).toBe(false);
  });

  it('ignores short lines that legitimately repeat (blank, braces, bullets)', () => {
    const g = new RepetitionGuard();
    g.push('\n\n\n\n\n}\n}\n}\n}\n- x\n- x\n- x\n- x\n');
    expect(g.tripped).toBe(false);
  });

  it('does not trip on valid generated code', () => {
    const g = new RepetitionGuard();
    g.push(
      [
        'const doc = new jsPDF();',
        "doc.text('Facture', 20, 20);",
        "doc.autoTable({ head: [['Article', 'Prix']], body: [['A', '1'], ['B', '2']] });",
        "return doc.output('blob');",
        '',
      ].join('\n'),
    );
    expect(g.tripped).toBe(false);
  });

  it('only counts consecutive repeats', () => {
    const g = new RepetitionGuard();
    g.push([LOOP, LOOP, 'something else entirely here', LOOP, LOOP, LOOP, ''].join('\n'));
    expect(g.tripped).toBe(false);
  });
});
