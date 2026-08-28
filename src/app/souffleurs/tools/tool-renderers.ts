/**
 * Renderers des segments d'outils (registerToolRenderer) :
 *  - write_file / transform_file : carte artefact (nom, taille, téléchargement,
 *    aperçu HTML échappé généré par NOS runtimes) ;
 *  - create_widget : contenu inline — svg/html en iframe sandboxée (jamais
 *    d'injection directe de contenu généré), chart via Chart.js lazy, code échappé ;
 *  - compute : invisible (l'utilisateur ne voit pas le calcul, règle contrat).
 */
import { aparteGlobalConfig } from '@aparte/core';
import type { AparteToolCallSegment, AparteToolRenderer } from '@aparte/core';
import {
  loadArtifact,
  subscribeLiveArtifact,
  triggerDownload,
  widgetsByCall,
  type ProducedArtifact,
} from './artifact-store';

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
.bp-tool-line { display: flex; padding: 2px 0; }
.bp-tool-note { color: var(--aparte-text-muted); font-size: 12.5px; font-family: var(--bp-mono, monospace); }
.bp-artifact-live:empty { display: none; }
.bp-artifact-code pre { margin: 10px 0 0; max-height: 200px; overflow: auto; font-family: var(--bp-mono, monospace); font-size: 11.5px; color: var(--aparte-text-muted); border-top: 1px solid var(--aparte-border); padding-top: 10px; }
.bp-artifact-code pre.shiki { background: var(--aparte-surface-2) !important; border-radius: 8px; padding: 10px 12px; border-top: none; }
.bp-artifact-preview:empty, .bp-artifact-pdf:empty { display: none; }
.bp-artifact-pdf { margin-top: 10px; border-top: 1px solid var(--aparte-border); padding-top: 10px; display: grid; gap: 8px; }
.bp-artifact-pdf canvas { border: 1px solid var(--aparte-border); border-radius: 8px; background: #fff; }
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

/** Carte artefact — write_file et transform_file (aperçu LIVE pendant la génération). */
export const artifactCardRenderer: AparteToolRenderer = {
  render(segment) {
    const result = parseResult(segment);
    if (segment.status === 'pending') {
      return `<div class="aparte-segment bp-artifact-card" data-segment-id="${esc(segment.id)}">
  <div class="bp-artifact-head">
    <span class="bp-artifact-icon">('.')…</span>
    <span class="bp-artifact-meta">génération du document…</span>
  </div>
  <div class="bp-artifact-live"></div>
</div>`;
    }
    if (result && !result['ok']) {
      return `<div class="aparte-segment bp-artifact-card" data-segment-id="${esc(segment.id)}"><span class="bp-artifact-error">(x.x) ${esc(result['error'] ?? 'échec')}</span></div>`;
    }
    // Carte finale — TOLÉRANTE : si `result` n'a pas survécu à la sérialisation
    // de l'arbre (reload), setup() remplit la tête depuis l'artefact persisté.
    const glyph = KIND_GLYPHS[String(result?.['type'] ?? '')] ?? KIND_GLYPHS['default'];
    return `<div class="aparte-segment bp-artifact-card" data-segment-id="${esc(segment.id)}">
  <div class="bp-artifact-head">
    <span class="bp-artifact-icon">${glyph}</span>
    <span class="bp-artifact-name">${esc(result?.['filename'] ?? '…')}</span>
    <span class="bp-artifact-meta">${result?.['size_kb'] !== undefined ? `${esc(result['size_kb'])} Ko` : ''}</span>
    <button class="bp-artifact-dl">Télécharger</button>
  </div>
  <div class="bp-artifact-preview"></div>
  <div class="bp-artifact-pdf"></div>
</div>`;
  },
  setup(element, segment) {
    // Aperçu live (statut pending) : l'élément est stable pendant l'exécution,
    // on le met à jour au fil du stream de l'exécuteur.
    const live = element.querySelector<HTMLElement>('.bp-artifact-live');
    if (live && segment.status === 'pending') {
      subscribeLiveArtifact(segment.toolCall.id, (state) => {
        if (state.html !== undefined) {
          live.classList.add('bp-artifact-preview');
          live.innerHTML = state.html; // généré par NOS runtimes (contenu échappé)
        } else if (state.code !== undefined) {
          liveCode.set(live, state.code);
          if (!live.classList.contains('bp-artifact-code')) {
            live.classList.add('bp-artifact-code');
            live.innerHTML = '<pre></pre>';
          }
          // Avant la première passe Shiki : texte brut. Après : on ne touche
          // plus au DOM entre deux passes (sinon clignotement).
          if (!live.dataset['highlighted']) {
            const pre = live.querySelector('pre');
            if (pre) {
              pre.textContent = state.code;
              pre.scrollTop = pre.scrollHeight;
            }
          }
          scheduleLiveHighlight(live);
        }
      });
      return;
    }

    // Carte finale : artefact depuis la Map, sinon réhydraté (reload).
    void loadArtifact(segment.toolCall.id).then((artifact) => {
      if (!artifact || !element.isConnected) return;
      const nameEl = element.querySelector<HTMLElement>('.bp-artifact-name');
      if (nameEl && nameEl.textContent === '…') nameEl.textContent = artifact.filename;
      const metaEl = element.querySelector<HTMLElement>('.bp-artifact-meta');
      if (metaEl && !metaEl.textContent) {
        metaEl.textContent = `${(artifact.blob.size / 1024).toFixed(1)} Ko`;
      }
      element.querySelector<HTMLButtonElement>('.bp-artifact-dl')?.addEventListener('click', () =>
        triggerDownload(artifact.blob, artifact.filename),
      );
      const previewHost = element.querySelector<HTMLElement>('.bp-artifact-preview');
      if (previewHost && artifact.preview) previewHost.innerHTML = artifact.preview;
      const pdfHost = element.querySelector<HTMLElement>('.bp-artifact-pdf');
      if (pdfHost && artifact.mime === 'application/pdf') {
        void renderPdfPreview(pdfHost, artifact);
      }
    });
  },
  getStyles: () => CARD_STYLES,
};

/**
 * Coloration syntaxique du code live (Shiki via aparteGlobalConfig, déjà branché) —
 * throttlée à ~600 ms. Après la première passe réussie, SEULES les passes Shiki
 * touchent le DOM (jamais de textContent brut par-dessus → pas de clignotement).
 */
const liveCode = new WeakMap<HTMLElement, string>();
const highlightTimers = new WeakMap<HTMLElement, number>();
function scheduleLiveHighlight(host: HTMLElement): void {
  if (!aparteGlobalConfig.hasHighlightProvider() || highlightTimers.has(host)) return;
  highlightTimers.set(
    host,
    window.setTimeout(async () => {
      highlightTimers.delete(host);
      const code = liveCode.get(host) ?? '';
      try {
        const html = await aparteGlobalConfig.highlightCode(code, 'javascript');
        if (host.isConnected && host.classList.contains('bp-artifact-code')) {
          host.dataset['highlighted'] = '1';
          host.innerHTML = html; // Shiki échappe le code — html sûr
          const pre = host.querySelector('pre');
          if (pre) pre.scrollTop = pre.scrollHeight;
          // Du code est arrivé pendant la passe → re-programmer avec le dernier état.
          if (liveCode.get(host) !== code) scheduleLiveHighlight(host);
        }
      } catch {
        /* highlighter pas prêt : le textContent brut reste affiché */
      }
    }, 600),
  );
}

/**
 * Aperçu PDF en canvas via pdfjs (lazy). Le viewer natif en iframe est BLOQUÉ
 * par notre COEP credentialless (carré gris) — pdfjs rend sous notre origine.
 */
async function renderPdfPreview(host: HTMLElement, artifact: ProducedArtifact): Promise<void> {
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: await artifact.blob.arrayBuffer() }).promise;
    const pages = Math.min(doc.numPages, 2);
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = ((host.clientWidth || 440) / baseViewport.width) * (window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = '100%';
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      host.appendChild(canvas);
    }
    if (doc.numPages > pages) {
      const more = document.createElement('p');
      more.className = 'bp-artifact-meta';
      more.textContent = `… ${doc.numPages - pages} page(s) de plus dans le fichier`;
      host.appendChild(more);
    }
  } catch (err) {
    console.warn('[souffleurs] aperçu PDF indisponible', err);
  }
}

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

/**
 * read_file — le renderer GÉNÉRIQUE de la lib n'affiche que le nom de l'outil
 * et une icône ✓/✗ : `segment.result` n'est jamais rendu. Un survol en échec
 * (« file_id inconnu », image sans vision, lecture impossible) apparaissait
 * donc comme une pastille muette — « l'outil tombe en erreur sans info ».
 * Ici : succès = pastille discrète (le survol nourrit le modèle, pas l'humain),
 * échec = message d'erreur RÉEL sous les yeux de l'utilisateur.
 */
export const readFileRenderer: AparteToolRenderer = {
  render(segment) {
    if (segment.status === 'pending') {
      return `<div class="aparte-segment bp-tool-line" data-segment-id="${esc(segment.id)}"><span class="bp-tool-note">('.')… lecture du fichier</span></div>`;
    }
    const result = parseResult(segment);
    if (result && result['ok'] === false) {
      const detail = result['error'] ?? 'lecture impossible';
      return `<div class="aparte-segment bp-artifact-card" data-segment-id="${esc(segment.id)}"><span class="bp-artifact-error">(x.x) ${esc(detail)}</span></div>`;
    }
    const name = result?.['name'] ?? result?.['file_id'] ?? '';
    // Voie IMAGE : la description produite par l'encodeur est le seul retour
    // visible de la vision. La montrer évite d'avoir à ouvrir la console pour
    // savoir si le problème vient du VL ou du rendu de souffleur-chat.
    const description = result?.['description'];
    if (typeof description === 'string' && description) {
      const dims =
        result?.['width'] && result?.['height']
          ? `${esc(result['width'])}×${esc(result['height'])}`
          : '';
      // Rend VISIBLE le chemin pris par le contrat : sans `query` c'est le
      // survol, avec `query` la question ciblée. Évite d'aller en console pour
      // savoir ce que le modèle a réellement demandé.
      const q = result?.['query'];
      const mode = typeof q === 'string' && q ? `« ${esc(q)} »` : 'survol';
      return `<div class="aparte-segment bp-artifact-card" data-segment-id="${esc(segment.id)}">
  <div class="bp-artifact-head">
    <span class="bp-artifact-icon">(o.o)</span>
    <span class="bp-artifact-name">${esc(name)}</span>
    <span class="bp-artifact-meta">${mode}${dims ? ` · ${dims}` : ''}</span>
  </div>
  <div class="bp-artifact-preview">${esc(description)}</div>
</div>`;
    }
    return `<div class="aparte-segment bp-tool-line" data-segment-id="${esc(segment.id)}"><span class="bp-tool-note">(▤) fichier lu${name ? ` — ${esc(name)}` : ''}</span></div>`;
  },
  getStyles: () => CARD_STYLES,
};

/** compute : invisible (le résultat nourrit la réponse texte du modèle). */
export const invisibleRenderer: AparteToolRenderer = {
  render: () => '',
};

/**
 * ⚠️ La lib n'injecte getStyles() d'un tool renderer QU'À l'événement
 * `tool-start` (génération live) — au reload d'une conversation, aucun
 * tool-start ne se produit et la carte s'affichait SANS styles (bloc absent,
 * canvas géants). On injecte donc nous-mêmes à l'enregistrement.
 * (Amélioration lib à proposer : injecter dans registerToolRenderer.)
 */
export function installToolRendererStyles(): void {
  const id = 'bp-tool-renderer-styles';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = CARD_STYLES;
  document.head.appendChild(style);
}
