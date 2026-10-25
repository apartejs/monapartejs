import type { AdapterName } from './model-catalog';

/**
 * main ↔ engine protocol: one model in memory, the souffleur chosen by its LoRA adapter.
 * Spoken by the wllama engine (ADR-014) the way the transformers.js worker spoke it, so the
 * provider's queue and handlers did not change with the engine.
 */

export type ComputeDevice = 'webgpu' | 'wasm';

/** Files resolved by the manifest's `gguf` block (immutable versioned names, repo-relative). */
export interface AdapterFiles {
  /** e.g. 'gguf/lfm25-vl-1.6b-Q4_K_M.gguf' — shared by every souffleur and by vision. */
  baseFile: string;
  /** e.g. 'gguf/souffleur-chat-0.3.0-lora-f16.gguf' */
  adapterFile: string;
}

export type MainToWorker =
  | ({ type: 'prepare'; id: number; adapter: AdapterName; device: ComputeDevice } & AdapterFiles)
  | ({
      type: 'generate';
      id: number;
      adapter: AdapterName;
      device: ComputeDevice;
      prompt: string;
      maxNewTokens: number;
      /** Console trace of the raw output. */
      debug?: boolean;
    } & AdapterFiles)
  | ({
      /** Prefill a prompt prefix into the cache so the next turn starting with it is fast. */
      type: 'warm';
      id: number;
      adapter: AdapterName;
      device: ComputeDevice;
      prefix: string;
    } & AdapterFiles)
  | {
      /**
       * read_file(image): the base WITHOUT adapter plus the vision encoder (mmproj) — the
       * pristine model, the one the encoder was trained with. Mechanically a souffleur swap.
       */
      type: 'describe-image';
      id: number;
      device: ComputeDevice;
      blob: Blob;
      question: string;
      maxNewTokens: number;
      baseFile: string;
      mmprojFile: string;
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
  | { type: 'ready'; id: number; adapter: AdapterName | 'vision'; ms: number }
  | { type: 'chunk'; id: number; delta: string }
  | {
      type: 'done';
      id: number;
      usage: { inputTokens: number; outputTokens: number; ttftMs: number; durationMs: number };
    }
  | { type: 'error'; id: number; message: string };

/** What the provider talks to: the worker's message surface, in the same thread. */
export interface WorkerLike {
  postMessage(msg: MainToWorker): void;
  onmessage: ((event: { data: WorkerToMain }) => void) | null;
}

export interface EngineLike extends WorkerLike {
  /** true when every file (repo-relative) is already in the local cache. */
  isCached(files: readonly string[]): Promise<boolean>;
}
