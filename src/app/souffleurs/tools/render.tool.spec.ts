import { beforeEach, describe, expect, it, vi } from 'vitest';

// The expert runs in the engine's worker: its output is the one thing replaced here.
const runExecutor = vi.fn();
vi.mock('../souffleurs-provider', () => ({ runExecutor: (...a: unknown[]) => runExecutor(...a) }));

const { renderHandler } = await import('./render.tool');
const { artifactsByCall } = await import('./artifact-store');

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

  it('still refuses to edit an existing file', async () => {
    const res = await renderHandler(call({ kind: 'docx', task: 'x', file_ids: ['file_a1'] }));
    expect(JSON.parse(String(res.content)).ok).toBe(false);
    expect(runExecutor).not.toHaveBeenCalled();
  });
});
