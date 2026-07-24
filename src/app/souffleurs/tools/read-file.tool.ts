/**
 * read_file — chemin DÉTERMINISTE du contrat (« walker », pas de LLM) :
 * survol structuré du fichier joint. Le résultat JSON réinjecté (rôle tool,
 * indent 2) reproduit les formes vues à l'entraînement :
 *   xlsx → { ok, type:'read_file', file_id, mime, schema:{sheets…}, preview }
 * La voie image (vision) attend le packaging de l'encodeur (J4).
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { fileRegistry } from '../files/file-registry';

export const readFileTool: AparteTool = {
  name: 'read_file',
  description: 'Lit un fichier joint (survol déterministe).',
  // Schéma LOCAL (jamais sérialisé sur le fil — le wire vient de SOUFFLEUR_TOOL_DEFS).
  inputSchema: {
    type: 'object',
    required: ['file_id'],
    properties: { file_id: { type: 'string' }, query: { type: 'string' } },
  },
};

export const readFileHandler: AparteToolHandler = async (call) => {
  const fileId = String(call.input['file_id'] ?? '');
  const entry = fileRegistry.get(fileId);
  if (!entry) {
    return {
      toolCallId: call.id,
      content: JSON.stringify(
        { ok: false, type: 'read_file', file_id: fileId, error: 'file_id inconnu — aucun fichier joint sous cet identifiant' },
        null,
        2,
      ),
    };
  }

  let result: Record<string, unknown>;
  try {
    switch (entry.type) {
      case 'xlsx':
        result = await surveyXlsx(entry.blob);
        break;
      case 'csv':
      case 'txt':
        result = await surveyText(entry.blob);
        break;
      case 'image':
        result = {
          error: "analyse d'image indisponible pour l'instant (vision en préparation)",
        };
        break;
      default:
        result = { note: 'survol non structuré pour ce format — métadonnées seulement' };
    }
  } catch (err) {
    result = { error: `lecture impossible : ${err instanceof Error ? err.message : String(err)}` };
  }

  return {
    toolCallId: call.id,
    content: JSON.stringify(
      {
        ok: !('error' in result),
        type: 'read_file',
        file_id: entry.id,
        mime: entry.type,
        name: entry.name,
        size_kb: +(entry.blob.size / 1024).toFixed(1),
        ...result,
      },
      null,
      2,
    ),
  };
};

/** Survol xlsx (forme schema/preview iso training). Réutilisé par write_file (édition). */
export async function surveyXlsx(blob: Blob): Promise<Record<string, unknown>> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());

  const sheets: Record<string, unknown> = {};
  const previewLines: string[] = [];

  for (const sheet of workbook.worksheets) {
    const headerRow = sheet.getRow(1);
    const columns: { col: string; header: string; type: string }[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const sample = sheet.getRow(2).getCell(colNumber).value;
      columns.push({
        col: colLetter(colNumber),
        header: String(cell.value ?? ''),
        type: typeof sample === 'number' ? 'number' : 'text',
      });
    });
    sheets[sheet.name] = {
      rowCount: sheet.rowCount,
      dataRowCount: Math.max(0, sheet.actualRowCount - 1),
      colCount: columns.length,
      columns,
    };
    if (previewLines.length === 0 && columns.length) {
      previewLines.push(columns.map((c) => c.header).join(' | '));
      for (let r = 2; r <= Math.min(sheet.rowCount, 6); r++) {
        const cells = columns.map((_, i) => String(sheet.getRow(r).getCell(i + 1).value ?? ''));
        previewLines.push(cells.join(' | '));
      }
    }
  }
  return { schema: { sheets }, preview: previewLines.join('\n') };
}

async function surveyText(blob: Blob): Promise<Record<string, unknown>> {
  const text = await blob.text();
  const lines = text.split('\n');
  return {
    lineCount: lines.length,
    preview: lines.slice(0, 12).join('\n').slice(0, 1200),
  };
}

function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
