/**
 * Lib renderers (plain DOM, no Angular) — the mascot replaces aparté's error
 * rendering; the status line draws the bubble's own waiting dots. Candidate for
 * @aparte/plugin-mascot.
 */
import { aparteGlobalConfig } from '@aparte/core';

function faceEl(face: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'bp-mascotte-inline';
  const feat = document.createElement('span');
  feat.className = 'bp-mascotte-face';
  feat.textContent = face;
  wrap.appendChild(feat);
  return wrap;
}

/**
 * Status line (shown while a tool call is being written): the same three dots as a reply that has not
 * started yet — aparté's `.aparte-waiting` markup, so both waits look alike. The container keeps the
 * accessible name, so the text is not drawn.
 */
function statusRenderer(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'aparte-waiting';
  const dots = document.createElement('span');
  dots.className = 'aparte-dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'aparte-dot';
    dots.appendChild(dot);
  }
  el.appendChild(dots);
  return el;
}

/** Error: (x.x) + message (textContent — never innerHTML). */
function errorRenderer({ message }: { message: string }): HTMLElement {
  const el = faceEl('(x.x)');
  const label = document.createElement('span');
  label.className = 'bp-mascotte-error-text';
  label.textContent = message;
  el.appendChild(label);
  return el;
}

const STYLES = `
.bp-mascotte-inline { display: inline-flex; align-items: baseline; gap: 6px; }
.bp-mascotte-face { font-family: var(--bp-serif, serif); color: var(--bp-mascotte, var(--aparte-primary)); }
.bp-mascotte-error-text { color: var(--aparte-error); }
`;

let installed = false;

export function registerMascotteRenderers(): void {
  if (installed) return;
  installed = true;
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.appendChild(style);
  aparteGlobalConfig.setStatusRenderer(statusRenderer);
  aparteGlobalConfig.setErrorRenderer(errorRenderer);
}
