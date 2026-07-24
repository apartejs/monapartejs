import { beforeEach, describe, expect, it } from 'vitest';
import { extType, fileRegistry } from './file-registry';
import { readFileHandler } from '../tools/read-file.tool';

describe('fileRegistry', () => {
  beforeEach(() => fileRegistry.clear());

  it('génère des ids au format training file_<base36>_<n> et mappe les types', () => {
    const entry = fileRegistry.registerBlob(new Blob(['x']), 'rapport.pdf', 'application/pdf');
    expect(entry.id).toMatch(/^file_[a-z0-9]+_\d+$/);
    expect(entry.type).toBe('pdf');
  });

  it('listForWire : clés id/name/type dans cet ordre exact', () => {
    fileRegistry.registerBlob(new Blob(['a']), 'clients.xlsx', '');
    const wire = fileRegistry.listForWire();
    expect(Object.keys(wire[0])).toEqual(['id', 'name', 'type']);
    expect(wire[0].type).toBe('xlsx');
  });

  it('extType couvre les familles du contrat', () => {
    expect(extType('photo.JPG')).toBe('image');
    expect(extType('notes.md')).toBe('txt');
    expect(extType('data.csv')).toBe('csv');
    expect(extType('doc.docx')).toBe('docx');
  });
});

describe('readFileHandler', () => {
  beforeEach(() => fileRegistry.clear());

  it('file_id inconnu → ok:false, jamais de crash', async () => {
    const res = await readFileHandler(
      { id: 'c1', name: 'read_file', input: { file_id: 'file_fantome_9' } },
      new AbortController().signal,
    );
    const parsed = JSON.parse(res.content);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('file_id inconnu');
  });

  it('survol texte : lineCount + preview, JSON indenté', async () => {
    const entry = fileRegistry.registerBlob(
      new Blob(['ligne 1\nligne 2\nligne 3']),
      'notes.txt',
      'text/plain',
    );
    const res = await readFileHandler(
      { id: 'c2', name: 'read_file', input: { file_id: entry.id } },
      new AbortController().signal,
    );
    expect(res.content).toContain('\n  "ok": true');
    const parsed = JSON.parse(res.content);
    expect(parsed.lineCount).toBe(3);
    expect(parsed.preview).toContain('ligne 2');
    expect(parsed.mime).toBe('txt');
  });
});
