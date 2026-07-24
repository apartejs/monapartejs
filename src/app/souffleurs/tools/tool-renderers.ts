/**
 * Renderers des segments d'outils (registerToolRenderer) :
 *  - write_file / transform_file : carte artefact (nom, taille, téléchargement,
 *    aperçu HTML échappé généré par NOS runtimes) ;
 *  - create_widget : contenu inline — svg/html en iframe sandboxée (jamais
 *    d'injection directe de contenu généré), chart via Chart.js lazy, code échappé ;
 *  - compute : invisible (l'utilisateur ne voit pas le calcul, règle contrat).
 */
import type { AparteToolCallSegment, AparteToolRenderer } from '@aparte/core';
import { artifactsByCall, triggerDownload, widgetsByCall } from './artifact-store';

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CARD_STYLES = `
.bp-artifact-card { border: 1px solid var(--aparte-border); border-radius: 12px; background: var(--aparte-surface-1); padding: 12px 14px; margin: 6px 0; max-width: 480px; }
.bp-artifact-head { display: flex; align-items: center; gap: 10px; }
.bp-artifact-icon { font-family: var(--bp-serif, serif); color: var(--aparte-primary); font-size: 18px; }
.bp-artifact-name { font-weight: 500; font-size: 14px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-artifact-meta { color: var(--aparte-text-muted); font-size: 12px; }
.bp-artifact-dl { font: inherit; font-size: 12.5px; background: var(--aparte-primary); color: var(--aparte-on-primary, #fff); border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer; }
.bp-artifact-dl:hover { background: var(--aparte-primary-hover); }
.bp-artifact-preview { margin-top: 10px; max-height: 260px; overflow: auto; font-size: 12.5px; border-top: 1px solid var(--aparte-border); padding-top: 10px; }
.bp-artifact-preview table { border-collapse: collapse; width: 100%; }
.bp-artifact-preview th, .bp-artifact-preview td { border: 1px solid var(--aparte-border); padding: 3px 8px; text-align: left; }
.bp-artifact-preview th { background: var(--aparte-surface-2); }
.bp-artifact-error { color: var(--aparte-error); font-size: 13px; }
.bp-widget { border: 1px solid var(--aparte-border); border-radius: 12px; background: var(--aparte-surface-1); margin: 6px 0; overflow: hidden; }
.bp-widget iframe { display: block; width: 100%; min-height: 220px; border: none; background: #fff; }
.bp-widget pre { margin: 0; padding: 12px 14px; overflow: auto; font-family: var(--bp-mono, monospace); font-size: 12.5px; }
.bp-widget canvas { display: block; width: 100%; max-height: 320px; padding: 10px; box-sizing: border-box; }
`;

function parseResult(segment: AparteToolCallSegment): Record<string, unknown> | null {
  if (!segment.result) return null;
  try {
    return JSON.parse(segment.result) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const KIND_GLYPHS: Record<string, string> = {
  xlsx: '(▤)',
  docx: '(¶)',
  pdf: '(§)',
  default: "('.')",
};

/** Carte artefact — write_file et transform_file. */
export const artifactCardRenderer: AparteToolRenderer = {
  render(segment) {
    const result = parseResult(segment);
    if (segment.status === 'pending' || !result) {
      return `<div class="bp-artifact-card"><div class="bp-artifact-head"><span class="bp-artifact-icon">('.')…</span><span class="bp-artifact-meta">génération du document…</span></div></div>`;
    }
    if (!result['ok']) {
      return `<div class="bp-artifact-card"><span class="bp-artifact-error">(x.x) ${esc(result['error'] ?? 'échec')}</span></div>`;
    }
    const glyph = KIND_GLYPHS[String(result['type'])] ?? KIND_GLYPHS['default'];
    const artifact = artifactsByCall.get(segment.toolCall.id);
    return `
<div class="bp-artifact-card">
  <div class="bp-artifact-head">
    <span class="bp-artifact-icon">${glyph}</span>
    <span class="bp-artifact-name">${esc(result['filename'])}</span>
    <span class="bp-artifact-meta">${esc(result['size_kb'])} Ko</span>
    <button class="bp-artifact-dl" data-call="${esc(segment.toolCall.id)}">Télécharger</button>
  </div>
  ${artifact?.preview ? `<div class="bp-artifact-preview">${artifact.preview}</div>` : ''}
</div>`;
  },
  setup(element, segment) {
    element.querySelector<HTMLButtonElement>('.bp-artifact-dl')?.addEventListener('click', () => {
      const artifact = artifactsByCall.get(segment.toolCall.id);
      if (artifact) triggerDownload(artifact.blob, artifact.filename);
    });
  },
  getStyles: () => CARD_STYLES,
};

/** Widget inline — create_widget. */
export const widgetRenderer: AparteToolRenderer = {
  render(segment) {
    const result = parseResult(segment);
    if (segment.status === 'pending' || !result) {
      return `<div class="bp-widget"><pre>('.')… création du widget</pre></div>`;
    }
    if (!result['ok']) {
      return `<div class="bp-artifact-card"><span class="bp-artifact-error">(x.x) ${esc(result['error'] ?? 'échec')}</span></div>`;
    }
    const widget = widgetsByCall.get(segment.toolCall.id);
    if (!widget) return '';
    switch (widget.kind) {
      case 'chart':
        return `<div class="bp-widget"><canvas></canvas></div>`;
      case 'html':
      case 'svg':
        // Contenu généré → iframe SANDBOXÉE (svg: scripts inertes ; html: scripts
        // isolés sans same-origin). Jamais d'innerHTML direct.
        return `<div class="bp-widget"><iframe sandbox="${widget.kind === 'html' ? 'allow-scripts' : ''}"></iframe></div>`;
      case 'code':
      default:
        return `<div class="bp-widget"><pre></pre></div>`;
    }
  },
  setup(element, segment) {
    const widget = widgetsByCall.get(segment.toolCall.id);
    if (!widget) return;
    const iframe = element.querySelector('iframe');
    if (iframe) {
      iframe.srcdoc = widget.content;
      return;
    }
    const pre = element.querySelector('pre');
    if (pre && widget.kind === 'code') {
      pre.textContent = widget.content;
      return;
    }
    const canvas = element.querySelector('canvas');
    if (canvas && widget.kind === 'chart') {
      void (async () => {
        try {
          const config = JSON.parse(widget.content);
          const { Chart, registerables } = await import('chart.js');
          Chart.register(...registerables);
          new Chart(canvas, config);
        } catch {
          const fallback = document.createElement('pre');
          fallback.textContent = widget.content;
          canvas.replaceWith(fallback);
        }
      })();
    }
  },
  getStyles: () => CARD_STYLES,
};

/** compute : invisible (le résultat nourrit la réponse texte du modèle). */
export const invisibleRenderer: AparteToolRenderer = {
  render: () => '',
};
