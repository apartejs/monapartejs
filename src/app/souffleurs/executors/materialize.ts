/**
 * Materialization of executor outputs:
 *  - xlsx/docx: declarative JSON ops → ExcelJS / docx (runtimes ported from aimi);
 *  - pdf: jsPDF code executed in the sandbox Worker.
 */
import type { ProducedArtifact } from '../tools/artifact-store';
import { applyDocxOps, docxOpsPreview, type DocxOp } from './docx-ops-runtime';
import { extractCode, runInSandbox } from './sandbox';
import { applyXlsxOps, extractCompleteOps } from './xlsx-ops-runtime';

export type WriteFileKind = 'xlsx' | 'docx' | 'pdf';

const MIMES: Record<WriteFileKind, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

export function defaultFilename(kind: WriteFileKind, name?: string): string {
  if (name) {
    const clean = name.replace(/[\\/:*?"<>|]/g, '_');
    return clean.toLowerCase().endsWith(`.${kind}`) ? clean : `${clean}.${kind}`;
  }
  return `document-${new Date().toISOString().slice(0, 10)}.${kind}`;
}

/**
 * Without a `name` param from the caller nor a source file: name derived from
 * the intent (slug of the task's first words) — "facture pour Dupont" → facture-pour-dupont.pdf.
 */
export function filenameFromTask(kind: WriteFileKind, task: string): string {
  const slug = task
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-')
    .slice(0, 48);
  return slug ? `${slug}.${kind}` : defaultFilename(kind);
}

export async function materializeWriteFile(
  kind: WriteFileKind,
  rawExecutorOutput: string,
  opts: { originalXlsx?: ArrayBuffer | null; name?: string } = {},
): Promise<ProducedArtifact> {
  const filename = defaultFilename(kind, opts.name);

  if (kind === 'pdf') {
    const code = extractCode(rawExecutorOutput);
    const result = await runInSandbox('jspdf', code, { timeoutMs: 30_000 });
    if (result.kind !== 'binary') throw new Error('le code pdf n’a pas produit de binaire');
    return {
      kind,
      filename,
      mime: MIMES.pdf,
      blob: new Blob([result.data as BlobPart], { type: MIMES.pdf }),
      preview: '',
    };
  }

  const ops = extractCompleteOps(rawExecutorOutput);
  if (!ops.length) throw new Error('aucune op JSON valide dans la sortie de l’exécuteur');

  if (kind === 'xlsx') {
    const { bytes, preview } = await applyXlsxOps(ops, opts.originalXlsx ?? null);
    return {
      kind,
      filename,
      mime: MIMES.xlsx,
      blob: new Blob([bytes], { type: MIMES.xlsx }),
      preview,
      opsCount: ops.length,
    };
  }

  const bytes = await applyDocxOps(ops as DocxOp[]);
  return {
    kind,
    filename,
    mime: MIMES.docx,
    blob: new Blob([bytes], { type: MIMES.docx }),
    preview: docxOpsPreview(ops as DocxOp[]),
    opsCount: ops.length,
  };
}
