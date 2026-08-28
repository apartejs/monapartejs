/**
 * transform_file — transformation DÉTERMINISTE, sans IA (règle du contrat) :
 * conversions de format, merge/split PDF, conversion/redimensionnement d'image.
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { fileRegistry } from '../files/file-registry';
import { notifyArtifact } from './artifact-store';

export const transformFileTool: AparteTool = {
  name: 'transform_file',
  description: 'Transformation déterministe d’un fichier joint.',
  inputSchema: {
    type: 'object',
    required: ['file_id', 'target'],
    properties: {
      file_id: { type: 'string' },
      target: { enum: ['csv', 'xlsx', 'pdf', 'docx', 'png', 'jpg', 'webp', 'merge', 'split'] },
      options: { type: 'object' },
    },
  },
};

export const transformFileHandler: AparteToolHandler = async (call) => {
  const fileId = String(call.input['file_id'] ?? '');
  const target = String(call.input['target'] ?? '');
  const options = (call.input['options'] as Record<string, unknown> | undefined) ?? {};

  const fail = (error: string) => ({
    toolCallId: call.id,
    content: JSON.stringify({ ok: false, type: 'transform_file', target, error }, null, 2),
  });

  const source = fileRegistry.get(fileId);
  if (!source) return fail(`file_id inconnu: ${fileId}`);

  try {
    let blob: Blob;
    let filename: string;
    const stem = source.name.replace(/\.[^.]+$/, '');

    switch (target) {
      case 'csv': {
        blob = await xlsxToCsv(source.blob);
        filename = `${stem}.csv`;
        break;
      }
      case 'xlsx': {
        blob = await csvToXlsx(source.blob);
        filename = `${stem}.xlsx`;
        break;
      }
      case 'png':
      case 'jpg':
      case 'webp': {
        blob = await convertImage(source.blob, target, options);
        filename = `${stem}.${target}`;
        break;
      }
      case 'merge': {
        const ids = [fileId, ...((options['file_ids'] as string[] | undefined) ?? [])];
        blob = await mergePdfs(ids);
        filename = `${stem}-fusion.pdf`;
        break;
      }
      case 'split': {
        blob = await splitPdf(source.blob, options);
        filename = `${stem}-extrait.pdf`;
        break;
      }
      default:
        return fail(`conversion vers ${target} non prise en charge pour ${source.type}`);
    }

    // Pas de téléchargement auto : la carte a le bouton.
    const registered = fileRegistry.registerBlob(blob, filename, blob.type);
    notifyArtifact(
      call.id,
      { kind: target, filename, mime: blob.type, blob, preview: '' },
      registered.id,
    );

    return {
      toolCallId: call.id,
      content: JSON.stringify(
        {
          ok: true,
          type: 'transform_file',
          target,
          filename,
          size_kb: +(blob.size / 1024).toFixed(1),
        },
        null,
        2,
      ),
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
};

async function xlsxToCsv(blob: Blob): Promise<Blob> {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('classeur vide');
  const lines: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      const text =
        v && typeof v === 'object' && 'result' in v ? String(v.result ?? '') : String(v ?? '');
      cells.push(/[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    });
    lines.push(cells.join(','));
  });
  return new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
}

async function csvToXlsx(blob: Blob): Promise<Blob> {
  const { Workbook } = await import('exceljs');
  const text = await blob.text();
  const wb = new Workbook();
  const sheet = wb.addWorksheet('Feuille1');
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line) continue;
    sheet.addRow(parseCsvLine(line));
  }
  const bytes = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',' || ch === ';') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function convertImage(
  blob: Blob,
  target: 'png' | 'jpg' | 'webp',
  options: Record<string, unknown>,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  let { width, height } = bitmap;
  const maxWidth = Number(options['width'] ?? options['maxWidth'] ?? 0);
  if (maxWidth > 0 && width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas indisponible');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const mime = target === 'jpg' ? 'image/jpeg' : `image/${target}`;
  const quality = Number(options['quality'] ?? 0.9);
  return canvas.convertToBlob({ type: mime, quality });
}

async function mergePdfs(fileIds: string[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const id of fileIds) {
    const entry = fileRegistry.get(id);
    if (!entry) throw new Error(`file_id inconnu: ${id}`);
    const doc = await PDFDocument.load(await entry.blob.arrayBuffer());
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return new Blob([(await out.save()) as unknown as BlobPart], { type: 'application/pdf' });
}

/** options.pages : "1-3" ou [1,2,5] (1-indexé). Sans option : première page. */
async function splitPdf(blob: Blob, options: Record<string, unknown>): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(await blob.arrayBuffer());
  const total = src.getPageCount();

  let pages: number[];
  const spec = options['pages'];
  if (Array.isArray(spec)) pages = spec.map(Number);
  else if (typeof spec === 'string' && /^\d+\s*-\s*\d+$/.test(spec)) {
    const [a, b] = spec.split('-').map((s) => parseInt(s.trim(), 10));
    pages = Array.from({ length: b - a + 1 }, (_, i) => a + i);
  } else if (typeof spec === 'string' || typeof spec === 'number') pages = [Number(spec)];
  else pages = [1];

  const indices = pages.map((p) => p - 1).filter((i) => i >= 0 && i < total);
  if (!indices.length) throw new Error('plage de pages invalide');

  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  for (const page of copied) out.addPage(page);
  return new Blob([(await out.save()) as unknown as BlobPart], { type: 'application/pdf' });
}
