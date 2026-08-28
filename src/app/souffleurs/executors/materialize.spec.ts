import { describe, expect, it } from 'vitest';
import { extractCode } from './sandbox';
import { defaultFilename, filenameFromTask } from './materialize';
import { extractCompleteOps } from './xlsx-ops-runtime';
import { docxOpsPreview } from './docx-ops-runtime';

describe('extractCompleteOps (xlsx-docx executor output)', () => {
  it('parses a clean JSON array', () => {
    const ops = extractCompleteOps(
      '[{"op":"addWorksheet","name":"Contacts"},{"op":"setCell","cell":"A1","value":"Nom"}]',
    );
    expect(ops).toHaveLength(2);
    expect(ops[0]['op']).toBe('addWorksheet');
  });

  it('tolerates a markdown fence and a truncated ending', () => {
    const ops = extractCompleteOps(
      '```json\n[{"op":"setCell","cell":"A1","value":"X"},{"op":"setCe',
    );
    expect(ops).toHaveLength(1);
  });

  it('strings with nested braces', () => {
    const ops = extractCompleteOps('[{"op":"setCell","cell":"A1","value":"a {b} c"}]');
    expect(ops[0]['value']).toBe('a {b} c');
  });
});

describe('extractCode (pdf/sandbox executor output)', () => {
  it('strips fences and cuts at im_end', () => {
    expect(
      extractCode(
        '```js\nconst doc = new jsPDF();\nreturn doc.output("blob");\n```<|im_end|>pollution',
      ),
    ).toBe('const doc = new jsPDF();\nreturn doc.output("blob");');
  });

  it('leaves bare code unchanged', () => {
    expect(extractCode('return 2+2;')).toBe('return 2+2;');
  });
});

describe('docxOpsPreview', () => {
  it('escapes content (never injection from the ops)', () => {
    const html = docxOpsPreview([{ op: 'addParagraph', text: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('defaultFilename', () => {
  it('sanitizes and appends the extension', () => {
    expect(defaultFilename('xlsx', 'rapport: Q2/2026')).toBe('rapport_ Q2_2026.xlsx');
    expect(defaultFilename('pdf', 'devis.pdf')).toBe('devis.pdf');
    expect(defaultFilename('docx')).toMatch(/^document-\d{4}-\d{2}-\d{2}\.docx$/);
  });
});

describe('filenameFromTask', () => {
  it('meaningful slug from the intent (accents stripped, 6 words max)', () => {
    expect(filenameFromTask('pdf', 'Créer une facture élégante pour Dupont & Fils, TVA 20%')).toBe(
      'creer-une-facture-elegante-pour-dupont.pdf',
    );
  });
  it('empty task → dated fallback', () => {
    expect(filenameFromTask('xlsx', '—')).toMatch(/^document-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
