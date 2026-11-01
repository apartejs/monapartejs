/**
 * render (ADR-003) — the caller's one tool for what is drawn: the json-render expert turns the call's `task` into a
 * spec, and the app draws it — a PDF, Word or Excel file through the json-render exporters, a chart in the
 * conversation through ECharts. The same spec serves every kind: only the exporter changes.
 * Tool summary = CONFIRMATION ONLY, as write_file's (anti-hallucination lesson from the lab).
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { chartToEChartsOption, type ChartProps, type Exporter } from '@aparte/json-render-catalogs';
import { defaultFilename } from '../executors/materialize';
import { compileSpec, findChart } from '../executors/json-render';
import { fileRegistry } from '../files/file-registry';
import { runExecutor } from '../souffleurs-provider';
import { LFM3_RENDER_SYSTEM } from '../wire/contract-lfm3';
import {
  clearLiveArtifact,
  notifyArtifact,
  pushLiveArtifact,
  widgetsByCall,
} from './artifact-store';

const KINDS = ['xlsx', 'docx', 'pdf', 'chart'] as const;
type RenderKind = (typeof KINDS)[number];

/** Loaded on the first file of each kind: jsPDF, docx and ExcelJS stay out of the first load. */
const EXPORTERS: Record<Exclude<RenderKind, 'chart'>, () => Promise<Exporter>> = {
  pdf: async () => (await import('@aparte/json-render-pdf')).exportPdf,
  docx: async () => (await import('@aparte/json-render-docx')).exportDocx,
  xlsx: async () => (await import('@aparte/json-render-xlsx')).exportXlsx,
};

/** Activation by name: the model reads the contract's own words (wire/contract-lfm3.ts), not this schema. */
export const renderTool: AparteTool = {
  name: 'render',
  description: 'Crée un document (pdf, docx, xlsx) ou affiche un graphique.',
  inputSchema: {
    type: 'object',
    required: ['kind', 'task'],
    properties: {
      kind: { enum: [...KINDS] },
      task: { type: 'string' },
      file_ids: { type: 'array', items: { type: 'string' } },
      name: { type: 'string' },
    },
  },
};

export const renderHandler: AparteToolHandler = async (call, signal) => {
  const kind = String(call.input['kind'] ?? '') as RenderKind;
  const task = String(call.input['task'] ?? '');
  const fileIds = (call.input['file_ids'] as string[] | undefined) ?? [];
  const name = call.input['name'] ? String(call.input['name']) : undefined;

  const fail = (error: string) => ({
    toolCallId: call.id,
    content: JSON.stringify({ ok: false, type: kind || 'render', error }, null, 2),
  });

  if (!KINDS.includes(kind)) return fail(`kind invalide: ${kind}`);
  if (!task) return fail('task manquante');
  if (fileIds.length)
    return fail("la modification d'un fichier existant n'est pas encore disponible");

  try {
    // LIVE: the spec builds up in front of the user while the expert streams, as the PDF executor's code did.
    const { raw } = await runExecutor('souffleur-render', LFM3_RENDER_SYSTEM, task, {
      signal,
      onChunk: (text) => pushLiveArtifact(call.id, { code: text }),
    });
    clearLiveArtifact(call.id);
    const spec = compileSpec(raw);
    if (!spec) return fail("le document produit n'est pas lisible");

    if (kind === 'chart') {
      const chart = findChart(spec);
      if (!chart) return fail('aucun graphique dans ce qui a été produit');
      const option = chartToEChartsOption(chart as ChartProps);
      widgetsByCall.set(call.id, { kind: 'echarts', content: JSON.stringify(option) });
      return {
        toolCallId: call.id,
        content: JSON.stringify(
          { ok: true, type: 'chart', title: chart['title'] ?? null },
          null,
          2,
        ),
        structuredResult: { type: 'chart', option },
      };
    }

    const exportFile = await EXPORTERS[kind]();
    const file = await exportFile(
      spec,
      name ? { filename: defaultFilename(kind, name) } : undefined,
    );
    const blob = new Blob([file.buffer], { type: file.mime });
    const registered = fileRegistry.registerBlob(blob, file.filename, file.mime);
    // Word and Excel are drawn from the same spec in the card (escaped, inline styles only); the PDF card
    // draws its own pages.
    const preview =
      kind === 'pdf' ? '' : (await import('@aparte/json-render-preview')).preview(spec).html;
    notifyArtifact(
      call.id,
      { kind, filename: file.filename, mime: file.mime, blob, preview },
      registered.id,
    );
    return {
      toolCallId: call.id,
      content: JSON.stringify(
        { ok: true, type: kind, filename: file.filename, size_kb: +(blob.size / 1024).toFixed(1) },
        null,
        2,
      ),
    };
  } catch (err) {
    clearLiveArtifact(call.id);
    return fail(err instanceof Error ? err.message : String(err));
  }
};
