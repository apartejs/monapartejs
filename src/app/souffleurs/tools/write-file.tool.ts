/**
 * write_file — l'appel du caller déclenche l'exécuteur hot-swappé
 * (souffleur-pdf ou souffleur-xlsx-docx), la matérialisation, l'enregistrement
 * de l'artefact et le téléchargement. Résumé tool = CONFIRMATION SEULE
 * (leçon anti-hallucination du lab : pas de preview/notes dans le résultat).
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { PDF_SYSTEM, XLSX_DOCX_SYSTEM } from '../executors/executor-prompts';
import { docxOpsPreview } from '../executors/docx-ops-runtime';
import { materializeWriteFile, type WriteFileKind } from '../executors/materialize';
import { extractCompleteOps, previewXlsxOps } from '../executors/xlsx-ops-runtime';
import { fileRegistry } from '../files/file-registry';
import { runExecutor } from '../souffleurs-provider';
import {
  clearLiveArtifact,
  notifyArtifact,
  pushLiveArtifact,
  triggerDownload,
} from './artifact-store';
import { surveyXlsx } from './read-file.tool';

export const writeFileTool: AparteTool = {
  name: 'write_file',
  description: 'Crée ou modifie un fichier téléchargeable (xlsx/docx/pdf).',
  inputSchema: {
    type: 'object',
    required: ['kind', 'task'],
    properties: {
      kind: { enum: ['xlsx', 'docx', 'pdf'] },
      task: { type: 'string' },
      file_ids: { type: 'array', items: { type: 'string' } },
      name: { type: 'string' },
    },
  },
};

export const writeFileHandler: AparteToolHandler = async (call) => {
  const kind = String(call.input['kind'] ?? '') as WriteFileKind;
  const task = String(call.input['task'] ?? '');
  const fileIds = (call.input['file_ids'] as string[] | undefined) ?? [];
  const name = call.input['name'] ? String(call.input['name']) : undefined;

  const fail = (error: string) => ({
    toolCallId: call.id,
    content: JSON.stringify({ ok: false, type: kind || 'write_file', error }, null, 2),
  });

  if (!['xlsx', 'docx', 'pdf'].includes(kind)) return fail(`kind invalide: ${kind}`);
  if (!task) return fail('task manquante');

  try {
    // Édition : l'exécuteur reçoit l'intention + le schéma du fichier source.
    let executorTask = task;
    let originalXlsx: ArrayBuffer | null = null;
    const source = fileIds[0] ? fileRegistry.get(fileIds[0]) : undefined;
    if (fileIds[0] && !source) return fail(`file_id inconnu: ${fileIds[0]}`);
    if (source?.type === 'xlsx') {
      originalXlsx = await source.blob.arrayBuffer();
      const survey = await surveyXlsx(source.blob);
      executorTask += `\n\nSchema: ${JSON.stringify(survey['schema'] ?? {})}`;
    }

    const adapter = kind === 'pdf' ? 'souffleur-pdf' : 'souffleur-xlsx-docx';
    const system = kind === 'pdf' ? PDF_SYSTEM : XLSX_DOCX_SYSTEM;

    // Aperçu LIVE (iso aimi) : le document se construit pendant le stream.
    let lastLiveAt = 0;
    let lastOpsCount = 0;
    let previewBusy = false;
    const onChunk = (raw: string) => {
      if (kind === 'pdf') {
        pushLiveArtifact(call.id, { code: raw });
        return;
      }
      const now = Date.now();
      if (previewBusy || now - lastLiveAt < 700) return;
      const ops = extractCompleteOps(raw);
      if (ops.length === lastOpsCount) return;
      lastOpsCount = ops.length;
      lastLiveAt = now;
      if (kind === 'docx') {
        pushLiveArtifact(call.id, { html: docxOpsPreview(ops) });
      } else {
        previewBusy = true;
        void previewXlsxOps(ops)
          .then((html) => pushLiveArtifact(call.id, { html }))
          .catch(() => undefined)
          .finally(() => (previewBusy = false));
      }
    };

    const { raw } = await runExecutor(adapter, system, executorTask, { onChunk });
    clearLiveArtifact(call.id);

    const artifact = await materializeWriteFile(kind, raw, {
      originalXlsx,
      name: name ?? source?.name,
    });

    const registered = fileRegistry.registerBlob(artifact.blob, artifact.filename, artifact.mime);
    notifyArtifact(call.id, artifact, registered.id);
    triggerDownload(artifact.blob, artifact.filename);

    return {
      toolCallId: call.id,
      content: JSON.stringify(
        {
          ok: true,
          type: kind,
          filename: artifact.filename,
          size_kb: +(artifact.blob.size / 1024).toFixed(1),
          ...(artifact.opsCount !== undefined ? { ops_count: artifact.opsCount } : {}),
        },
        null,
        2,
      ),
    };
  } catch (err) {
    clearLiveArtifact(call.id);
    return fail(err instanceof Error ? err.message : String(err));
  }
};
