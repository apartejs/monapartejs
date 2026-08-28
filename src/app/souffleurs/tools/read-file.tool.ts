/**
 * read_file — the contract's DETERMINISTIC path ("walker", no LLM):
 * structured survey of the attached file. The reinjected JSON result (tool
 * role, indent 2) reproduces the shapes seen during training:
 *   xlsx → { ok, type:'read_file', file_id, mime, schema:{sheets…}, preview }
 * The image path goes through the hot-swap of the vision ENCODER (separate
 * describe call, no LoRA) — see surveyImage.
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { fileRegistry } from '../files/file-registry';
import { describeImage } from '../souffleurs-provider';

export const readFileTool: AparteTool = {
  name: 'read_file',
  description: 'Lit un fichier joint (survol déterministe).',
  // LOCAL schema (never serialized on the wire — the wire comes from SOUFFLEUR_TOOL_DEFS).
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
        {
          ok: false,
          type: 'read_file',
          file_id: fileId,
          error: 'file_id inconnu — aucun fichier joint sous cet identifiant',
        },
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
        result = await surveyImage(entry.blob, String(call.input['query'] ?? ''));
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

/** Xlsx survey (schema/preview shape iso training). Reused by write_file (edit). */
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

/**
 * IMAGE path = hot-swap of the vision ENCODER + separate describe call
 * (CONTRACT-HANDOFF §4: "architecture, not LoRA"). The rendered text goes into
 * `description` in the reinjected JSON — souffleur-chat itself stays text-only
 * and NEVER sees pixels.
 */
async function surveyImage(blob: Blob, query: string): Promise<Record<string, unknown>> {
  // WARNING: "Describe this image in one or two sentences" literally produced
  // ONE hollow sentence ("In this image we can see a logo.") — the VL obeys to
  // the letter, and souffleur-chat then had nothing left to say but the
  // dimensions. So we explicitly ask for what's used downstream, including the
  // TRANSCRIPTION of visible text (decisive for a logo, a screenshot, a
  // photographed document).
  const question = describePrompt(query.trim());
  const { width, height } = await imageDimensions(blob);
  const description = await describeImage(blob, question);
  // `description` FIRST: souffleur-chat used to lean on width/height
  // ("a 128x128 pixel logo") when the content came after.
  return {
    description,
    ...(query.trim() ? { query: query.trim() } : {}),
    width,
    height,
  };
}

/**
 * Instruction sent to the VL. The default stays ENGLISH — but it is now
 * CONTESTED by the measurement, and this switch exists to settle it once and for all.
 *
 * A/B from 21/08 on the bench (aparte-repetitions/export/run_souffleur.py, 7 probes,
 * deterministic decoding, the REAL English description against its faithful
 * French translation). On the DOWNSTREAM half — what souffleur-chat does with
 * the tool result — French is never worse, and English produces three defects
 * that French doesn't have:
 *
 *   "is there text?"       -> "the letters PR […] no visible text"
 *                              (it contradicts itself in the same sentence)
 *   "dark background?"     -> "clearly visible on a dark background"
 *                              (false: the logo is black on white)
 *   "which letters?"       -> "a small vertical V in blue"
 *                              (invented; the description says "vertical line")
 *
 * The model translates the description while answering, and loses or invents things along the way.
 *
 * The UPSTREAM half is NOT measured: does the tower describe just as well in
 * French? It is likely dominated by English, and a poorer French description
 * would cancel out the gain. That measurement needs the browser — the tower
 * doesn't exist on the bench side — hence this switch rather than a blind
 * flip:
 *
 *   localStorage.setItem('bp.vision.lang', 'fr')   // then reload
 *
 * Attach the same image twice and compare the DESCRIBE lines in the
 * console. If the French description holds up, this default becomes 'fr'.
 */
function describeLang(): 'en' | 'fr' {
  try {
    return localStorage.getItem('bp.vision.lang') === 'fr' ? 'fr' : 'en';
  } catch {
    return 'en';
  }
}

function describePrompt(query: string): string {
  if (describeLang() === 'fr') {
    return query
      ? `${query}\n\nRéponds uniquement à partir de ce qui est visible sur l'image. ` +
          "Retranscris tout texte lisible, exactement tel qu'il est écrit."
      : 'Décris cette image en détail : le sujet, le décor, les couleurs, et tout ce qui ' +
          "est notable. Retranscris tout texte lisible, exactement tel qu'il est écrit. " +
          'Sois précis et factuel — ne décris pas ce que tu ne vois pas.';
  }
  return query
    ? `${query}\n\nAnswer using only what is visible in the image. ` +
        'Transcribe any text you can read, exactly as written.'
    : 'Describe this image in detail: the subject, the setting, colours, and ' +
        'anything notable. Transcribe any text you can read, exactly as written. ' +
        'Be specific and factual — do not describe what you cannot see.';
}

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return { width: 0, height: 0 };
  }
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
