/** Observable state of the souffleurs model (sidebar badge, onboarding) — framework-agnostic. */

export type SouffleurStatus =
  'unknown' | 'not-downloaded' | 'downloading' | 'loading' | 'ready' | 'generating' | 'error';

export interface SouffleurStatusState {
  status: SouffleurStatus;
  /** 0-100 during a download. */
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

/** Internal to the souffleurs module. */
export function setSouffleurStatus(next: SouffleurStatusState): void {
  state = next;
  for (const l of listeners) l(next);
}
