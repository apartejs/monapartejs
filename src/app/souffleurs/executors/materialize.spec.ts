import { describe, expect, it } from 'vitest';
import { extractCode } from './sandbox';
import { defaultFilename, filenameFromTask } from './materialize';
import { extractCompleteOps } from './xlsx-ops-runtime';
import { docxOpsPreview } from './docx-ops-runtime';

describe('extractCompleteOps (sortie exécuteur xlsx-docx)', () => {
  it('parse un array JSON propre', () => {
    const ops = extractCompleteOps('[{"op":"addWorksheet","name":"Contacts"},{"op":"setCell","cell":"A1","value":"Nom"}]');
    expect(ops).toHaveLength(2);
    expect(ops[0]['op']).toBe('addWorksheet');
  });

  it('tolère une fence markdown et une fin tronquée', () => {
    const ops = extractCompleteOps('```json\n[{"op":"setCell","cell":"A1","value":"X"},{"op":"setCe');
    expect(ops).toHaveLength(1);
  });

  it('strings avec accolades imbriquées', () => {
    const ops = extractCompleteOps('[{"op":"setCell","cell":"A1","value":"a {b} c"}]');
    expect(ops[0]['value']).toBe('a {b} c');
  });
});

describe('extractCode (sortie exécuteur pdf/sandbox)', () => {
  it('retire les fences et coupe à im_end', () => {
    expect(extractCode('```js\nconst doc = new jsPDF();\nreturn doc.output("blob");\n```<|im_end|>pollution')).toBe(
      'const doc = new jsPDF();\nreturn doc.output("blob");',
    );
  });

  it('code nu inchangé', () => {
    expect(extractCode('return 2+2;')).toBe('return 2+2;');
  });
});

describe('docxOpsPreview', () => {
  it('échappe le contenu (jamais d’injection depuis les ops)', () => {
    const html = docxOpsPreview([{ op: 'addParagraph', text: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('defaultFilename', () => {
  it('assainit et suffixe l’extension', () => {
    expect(defaultFilename('xlsx', 'rapport: Q2/2026')).toBe('rapport_ Q2_2026.xlsx');
    expect(defaultFilename('pdf', 'devis.pdf')).toBe('devis.pdf');
    expect(defaultFilename('docx')).toMatch(/^document-\d{4}-\d{2}-\d{2}\.docx$/);
  });
});

describe('filenameFromTask', () => {
  it('slug parlant depuis l’intention (accents retirés, 6 mots max)', () => {
    expect(filenameFromTask('pdf', 'Créer une facture élégante pour Dupont & Fils, TVA 20%')).toBe(
      'creer-une-facture-elegante-pour-dupont.pdf',
    );
  });
  it('task vide → repli daté', () => {
    expect(filenameFromTask('xlsx', '—')).toMatch(/^document-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});
