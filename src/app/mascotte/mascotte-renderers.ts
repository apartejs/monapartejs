/**
 * Lib renderers (plain DOM, no Angular) — the mascot replaces aparté's
 * typing indicator and error rendering. Candidate for @aparte/plugin-mascot.
 */
import { aparteGlobalConfig } from '@aparte/core';

function faceEl(face: string, suffixClass?: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'bp-mascotte-inline';
  const feat = document.createElement('span');
  feat.className = 'bp-mascotte-face';
  feat.textContent = face;
  wrap.appendChild(feat);
  if (suffixClass) {
    const suffix = document.createElement('span');
    suffix.className = suffixClass;
    wrap.appendChild(suffix);
  }
  return wrap;
}

/** "Currently writing" indicator: ('.')… + status text. */
function statusRenderer(text: string): HTMLElement {
  const el = faceEl("('.')", 'bp-mascotte-dots');
  const label = document.createElement('span');
  label.className = 'bp-mascotte-status-text';
  label.textContent = text;
  el.appendChild(label);
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
.bp-mascotte-dots::after { content: '…'; color: var(--aparte-text-muted); animation: bp-mascotte-dots 1.6s steps(4) infinite; }
.bp-mascotte-status-text { color: var(--aparte-text-muted); }
.bp-mascotte-error-text { color: var(--aparte-error); }
@keyframes bp-mascotte-dots { 0% { opacity: .2; } 50% { opacity: 1; } 100% { opacity: .2; } }
@media (prefers-reduced-motion: reduce) { .bp-mascotte-dots::after { animation: none; } }
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
