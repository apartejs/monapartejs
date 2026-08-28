/**
 * read_file — chemin DÉTERMINISTE du contrat (« walker », pas de LLM) :
 * survol structuré du fichier joint. Le résultat JSON réinjecté (rôle tool,
 * indent 2) reproduit les formes vues à l'entraînement :
 *   xlsx → { ok, type:'read_file', file_id, mime, schema:{sheets…}, preview }
 * La voie image passe par le hot-swap de l'ENCODEUR vision (appel describe
 * séparé, sans LoRA) — cf. surveyImage.
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { fileRegistry } from '../files/file-registry';
import { describeImage } from '../souffleurs-provider';

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

/**
 * Voie IMAGE = hot-swap de l'ENCODEUR vision + appel describe séparé
 * (CONTRACT-HANDOFF §4 : « archi, pas de LoRA »). Le texte rendu part en
 * `description` dans le JSON réinjecté — souffleur-chat, lui, reste text-only
 * et ne voit JAMAIS de pixels.
 */
async function surveyImage(blob: Blob, query: string): Promise<Record<string, unknown>> {
  // ATTENTION : « Describe this image in one or two sentences » donnait
  // littéralement UNE phrase creuse (« In this image we can see a logo. ») —
  // le VL obéit au pied de la lettre, et souffleur-chat n’avait alors plus rien
  // à dire que les dimensions. On demande donc explicitement ce qui sert en
  // aval, dont la TRANSCRIPTION du texte visible (décisive pour un logo, une
  // capture d’écran, un document photographié).
  const question = describePrompt(query.trim());
  const { width, height } = await imageDimensions(blob);
  const description = await describeImage(blob, question);
  // `description` en TÊTE : souffleur-chat s’appuyait sur width/height
  // (« un logo de 128x128 pixels ») quand le contenu venait après.
  return {
    description,
    ...(query.trim() ? { query: query.trim() } : {}),
    width,
    height,
  };
}

/**
 * Consigne envoyée au VL. Le défaut reste l'ANGLAIS — mais il est désormais
 * CONTESTÉ par la mesure, et ce commutateur existe pour finir de trancher.
 *
 * A/B du 21/08 au banc (aparte-repetitions/export/run_souffleur.py, 7 sondes,
 * décodage déterministe, la description anglaise RÉELLE contre sa traduction
 * française fidèle). Sur la moitié AVAL — ce que souffleur-chat fait du
 * résultat d'outil — le français n'est jamais pire, et l'anglais produit trois
 * défauts que le français n'a pas :
 *
 *   « il y a du texte ? » -> « les lettres PR […] aucun texte visible »
 *                            (il se contredit dans la même phrase)
 *   « fond sombre ? »     -> « bien visible sur un fond sombre »
 *                            (faux : le logo est noir sur blanc)
 *   « quelles lettres ? » -> « un petit V vertical en bleu »
 *                            (inventé ; la description dit « ligne verticale »)
 *
 * Le modèle traduit la description en répondant, et perd ou invente au passage.
 *
 * La moitié AMONT n'est PAS mesurée : la tour décrit-elle aussi bien en
 * français ? Elle est vraisemblablement dominée par l'anglais, et une
 * description française plus pauvre annulerait le gain. Cette mesure demande le
 * navigateur — la tour n'existe pas côté banc — d'où ce commutateur plutôt
 * qu'une bascule à l'aveugle :
 *
 *   localStorage.setItem('bp.vision.lang', 'fr')   // puis recharger
 *
 * Joindre deux fois la même image et comparer les lignes DESCRIBE de la
 * console. Si la description française tient, ce défaut devient 'fr'.
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
