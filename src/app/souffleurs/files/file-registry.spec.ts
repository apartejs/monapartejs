import { beforeEach, describe, expect, it } from 'vitest';
import { extType, fileRegistry, setConversationResolver } from './file-registry';
import { readFileHandler } from '../tools/read-file.tool';

describe('fileRegistry', () => {
  beforeEach(() => fileRegistry.clear());

  it('generates ids in the training file_<base36>_<n> format and maps types', () => {
    const entry = fileRegistry.registerBlob(new Blob(['x']), 'rapport.pdf', 'application/pdf');
    expect(entry.id).toMatch(/^file_[a-z0-9]+_\d+$/);
    expect(entry.type).toBe('pdf');
  });

  it('listForWire: id/name/type keys in this exact order', () => {
    fileRegistry.registerBlob(new Blob(['a']), 'clients.xlsx', '');
    const wire = fileRegistry.listForWire();
    expect(Object.keys(wire[0])).toEqual(['id', 'name', 'type']);
    expect(wire[0].type).toBe('xlsx');
  });

  it('extType covers the contract families', () => {
    expect(extType('photo.JPG')).toBe('image');
    expect(extType('notes.md')).toBe('txt');
    expect(extType('data.csv')).toBe('csv');
    expect(extType('doc.docx')).toBe('docx');
  });
});

describe('readFileHandler', () => {
  beforeEach(() => fileRegistry.clear());

  it('unknown file_id → ok:false, never a crash', async () => {
    const res = await readFileHandler(
      { id: 'c1', name: 'read_file', input: { file_id: 'file_fantome_9' } },
      new AbortController().signal,
    );
    const parsed = JSON.parse(res.content);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('file_id inconnu');
  });

  it('text survey: lineCount + preview, indented JSON', async () => {
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

describe('fileRegistry — partitioning by conversation', () => {
  let active: string | null = null;

  beforeEach(() => {
    fileRegistry.clear();
    active = null;
    setConversationResolver(() => active);
  });

  it('a file attached in one thread is not announced in another', () => {
    active = 'conv-a';
    fileRegistry.registerBlob(new Blob(['x']), 'pr.jpg', 'image/jpeg');

    active = 'conv-b';
    expect(fileRegistry.listForWire()).toEqual([]);

    active = 'conv-a';
    expect(fileRegistry.listForWire().map((f) => f.name)).toEqual(['pr.jpg']);
  });

  it('a fresh thread only sees what was just attached to it', () => {
    active = 'conv-a';
    fileRegistry.registerBlob(new Blob(['x']), 'ancien.pdf', 'application/pdf');

    // New thread: no id yet.
    active = null;
    expect(fileRegistry.listForWire()).toEqual([]);

    fileRegistry.registerBlob(new Blob(['y']), 'nouveau.png', 'image/png');
    expect(fileRegistry.listForWire().map((f) => f.name)).toEqual(['nouveau.png']);
  });

  it('adoptPending attaches files joined before the thread was created', () => {
    active = null;
    fileRegistry.registerBlob(new Blob(['y']), 'nouveau.png', 'image/png');

    expect(fileRegistry.adoptPending('conv-c')).toBe(1);

    active = 'conv-c';
    expect(fileRegistry.listForWire().map((f) => f.name)).toEqual(['nouveau.png']);

    // And most importantly: the NEXT fresh thread starts empty.
    active = null;
    expect(fileRegistry.listForWire()).toEqual([]);
  });

  it('get() resolves a file_id from another thread — history must stay readable', () => {
    active = 'conv-a';
    const entry = fileRegistry.registerBlob(new Blob(['x']), 'pr.jpg', 'image/jpeg');

    active = 'conv-b';
    expect(fileRegistry.listForWire()).toEqual([]);
    expect(fileRegistry.get(entry.id)?.name).toBe('pr.jpg');
  });

  it('a row predating attachment is listed nowhere', () => {
    // hydrate() puts rows back as-is: convId absent.
    const legacy = fileRegistry.registerBlob(new Blob(['x']), 'legacy.pdf', 'application/pdf');
    delete (fileRegistry.get(legacy.id) as { convId?: string | null }).convId;

    active = null;
    expect(fileRegistry.listForWire()).toEqual([]);
    active = 'conv-a';
    expect(fileRegistry.listForWire()).toEqual([]);
    expect(fileRegistry.get(legacy.id)?.name).toBe('legacy.pdf');
  });
});
