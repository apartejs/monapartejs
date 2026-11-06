import { beforeEach, describe, expect, it, vi } from 'vitest';

// The expert runs in the engine's worker: its output is the one thing replaced here.
const runExecutor = vi.fn();
vi.mock('../souffleurs-provider', () => ({ runExecutor: (...a: unknown[]) => runExecutor(...a) }));

const { renderHandler } = await import('./render.tool');
const { artifactsByCall } = await import('./artifact-store');
const { fileRegistry } = await import('../files/file-registry');

const INVOICE = [
  '```yaml-spec',
  'root: doc',
  'elements:',
  '  doc:',
  '    type: Document',
  '    props:',
  '      title: "Facture 42"',
  '      lang: "fr"',
  '    children:',
  '      - t1',
  '  t1:',
  '    type: Table',
  '    props:',
  '      columns:',
  '        - header: "Article"',
  '        - header: "Montant"',
  '          numeric: true',
  '      rows:',
  '        - - "Conseil"',
  '          - 1200',
  '```',
].join('\n');

const call = (input: Record<string, unknown>) => ({ id: 'c1', name: 'render', input });

describe('renderHandler', () => {
  beforeEach(() => {
    runExecutor.mockReset();
    runExecutor.mockResolvedValue({ raw: INVOICE });
  });

  it.each([
    ['docx', 'facture.docx'],
    ['xlsx', 'facture.xlsx'],
  ])('exports the expert spec as a %s file', async (kind, filename) => {
    const res = await renderHandler(call({ kind, task: 'Facture 42', name: 'facture' }));
    const content = JSON.parse(String(res.content));
    expect(content).toMatchObject({ ok: true, type: kind, filename });
    expect(content.size_kb).toBeGreaterThan(0);
  });

  it.each(['docx', 'xlsx'])('gives the %s file a preview of its content', async (kind) => {
    await renderHandler(call({ kind, task: 'Facture 42' }));
    const preview = artifactsByCall.get('c1')?.preview ?? '';
    expect(preview).toContain('Conseil');
    expect(preview).toContain('Facture 42');
  });

  it('still refuses to edit a file the user attached', async () => {
    const attached = fileRegistry.register(
      new File(['x'], 'devis.docx', { type: 'application/msword' }),
    );
    const res = await renderHandler(call({ kind: 'docx', task: 'x', file_ids: [attached.id] }));
    expect(JSON.parse(String(res.content)).ok).toBe(false);
    expect(runExecutor).not.toHaveBeenCalled();
  });

  it('rebuilds a document it produced from the joined intent, under the same file id and name', async () => {
    const produced = fileRegistry.registerBlob(
      new Blob(['old']),
      'facture.pdf',
      'application/pdf',
      'render',
    );
    const res = await renderHandler(
      call({ kind: 'pdf', task: 'Facture 42 : 5 heures', file_ids: [produced.id] }),
    );
    expect(JSON.parse(String(res.content))).toMatchObject({
      ok: true,
      type: 'pdf',
      filename: 'facture.pdf',
    });
    expect(runExecutor.mock.calls[0]?.[2]).toBe('Facture 42 : 5 heures');
    const after = fileRegistry.get(produced.id);
    expect(after?.blob.size).toBeGreaterThan(3);
    expect(after?.producedBy).toBe('render');
  });
});
