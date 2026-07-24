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
let sink: ArtifactSink | null = null;

/** L'app branche ici la persistance (table artifacts Dexie, galerie future). */
export function setArtifactSink(fn: ArtifactSink): void {
  sink = fn;
}

export function notifyArtifact(toolCallId: string, artifact: ProducedArtifact, fileId: string): void {
  artifactsByCall.set(toolCallId, artifact);
  try {
    sink?.(toolCallId, artifact, fileId);
  } catch (err) {
    console.warn('[souffleurs] artifact sink error', err);
  }
}

export function triggerDownload(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
