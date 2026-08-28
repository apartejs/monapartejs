/** État observable du modèle souffleurs (pastille sidebar, onboarding) — framework-agnostic. */

export type SouffleurStatus =
  'unknown' | 'not-downloaded' | 'downloading' | 'loading' | 'ready' | 'generating' | 'error';

export interface SouffleurStatusState {
  status: SouffleurStatus;
  /** 0-100 pendant un téléchargement. */
  progress?: number;
  message?: string;
  device?: 'webgpu' | 'wasm';
}

type Listener = (state: SouffleurStatusState) => void;

let state: SouffleurStatusState = { status: 'unknown' };
const listeners = new Set<Listener>();

export function getSouffleurStatus(): SouffleurStatusState {
  return state;
}

export function subscribeSouffleurStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** Interne au module souffleurs. */
export function setSouffleurStatus(next: SouffleurStatusState): void {
  state = next;
  for (const l of listeners) l(next);
}
