/**
 * Corrélation tool_call → artefact produit (pour les renderers) + sink de
 * persistance branché par l'app (le module souffleurs ne connaît pas Dexie).
 */

export interface ProducedArtifact {
  kind: string;
  filename: string;
  mime: string;
  blob: Blob;
  /** HTML d'aperçu généré par NOS runtimes (contenu échappé). */
  preview: string;
  opsCount?: number;
}

export interface ProducedWidget {
  kind: 'html' | 'svg' | 'chart' | 'code';
  content: string;
}

export const artifactsByCall = new Map<string, ProducedArtifact>();
export const widgetsByCall = new Map<string, ProducedWidget>();

type ArtifactSink = (toolCallId: string, artifact: ProducedArtifact, fileId: string) => void;
type ArtifactLoader = (toolCallId: string) => Promise<ProducedArtifact | null>;
let sink: ArtifactSink | null = null;
let loader: ArtifactLoader | null = null;

/** L'app branche ici la persistance (table artifacts Dexie, galerie future). */
export function setArtifactSink(fn: ArtifactSink): void {
  sink = fn;
}

/** L'app branche ici la RE-hydratation (après reload, la Map mémoire est vide). */
export function setArtifactLoader(fn: ArtifactLoader): void {
  loader = fn;
}

/** Artefact d'un tool_call : Map mémoire d'abord, sinon persistance (reload). */
export async function loadArtifact(toolCallId: string): Promise<ProducedArtifact | null> {
  const hit = artifactsByCall.get(toolCallId);
  if (hit) return hit;
  try {
    const fromStore = await loader?.(toolCallId);
    if (fromStore) artifactsByCall.set(toolCallId, fromStore);
    return fromStore ?? null;
  } catch {
    return null;
  }
}

export function notifyArtifact(toolCallId: string, artifact: ProducedArtifact, fileId: string): void {
  artifactsByCall.set(toolCallId, artifact);
  try {
    sink?.(toolCallId, artifact, fileId);
  } catch (err) {
    console.warn('[souffleurs] artifact sink error', err);
  }
}

/* ── Aperçu LIVE pendant la génération (iso aimi : le document se construit
 *    sous les yeux de l'utilisateur pendant le stream de l'exécuteur) ── */

export interface LiveArtifactState {
  /** HTML d'aperçu (échappé par nos runtimes) — xlsx/docx. */
  html?: string;
  /** Code en cours de génération (affiché en texte brut) — pdf. */
  code?: string;
}

const liveByCall = new Map<string, LiveArtifactState>();
const liveListeners = new Map<string, (state: LiveArtifactState) => void>();

export function pushLiveArtifact(toolCallId: string, patch: LiveArtifactState): void {
  const state = { ...liveByCall.get(toolCallId), ...patch };
  liveByCall.set(toolCallId, state);
  liveListeners.get(toolCallId)?.(state);
}

export function subscribeLiveArtifact(
  toolCallId: string,
  listener: (state: LiveArtifactState) => void,
): void {
  liveListeners.set(toolCallId, listener);
  const current = liveByCall.get(toolCallId);
  if (current) listener(current);
}

export function clearLiveArtifact(toolCallId: string): void {
  liveByCall.delete(toolCallId);
  liveListeners.delete(toolCallId);
}

export function triggerDownload(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
