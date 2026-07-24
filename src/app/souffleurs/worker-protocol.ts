import type { AdapterName } from './model-catalog';

/** Protocole main ↔ worker (un seul pipeline en mémoire, adapter hot-swappé). */

export type ComputeDevice = 'webgpu' | 'wasm';

export type MainToWorker =
  | { type: 'prepare'; id: number; adapter: AdapterName; device: ComputeDevice }
  | {
      type: 'generate';
      id: number;
      adapter: AdapterName;
      device: ComputeDevice;
      prompt: string;
      maxNewTokens: number;
      /** Trace console (ids des premiers tokens — contrôle double-BOS, etc.). */
      debug?: boolean;
    }
  | { type: 'abort' }
  | { type: 'dispose' };

export interface WorkerFileProgress {
  file: string;
  loaded: number;
  total: number;
  done: boolean;
}

export type WorkerToMain =
  | ({ type: 'progress'; id: number } & WorkerFileProgress)
  | { type: 'ready'; id: number; adapter: AdapterName; ms: number }
  | { type: 'chunk'; id: number; delta: string }
  | {
      type: 'done';
      id: number;
      usage: { inputTokens: number; outputTokens: number; ttftMs: number; durationMs: number };
    }
  | { type: 'error'; id: number; message: string };
