/**
 * Matérialisation des sorties d'exécuteurs :
 *  - xlsx/docx : ops JSON déclaratives → ExcelJS / docx (runtimes portés d'aimi) ;
 *  - pdf : code jsPDF exécuté dans la sandbox Worker.
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
