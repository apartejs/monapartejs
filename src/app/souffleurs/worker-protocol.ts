import type { AdapterName } from './model-catalog';

/** main ↔ worker protocol (a single in-memory pipeline, hot-swapped adapter). */

export type ComputeDevice = 'webgpu' | 'wasm';

/** Files resolved by the manifest (immutable versioned names). */
export interface AdapterFiles {
  /** e.g. 'onnx/model_q4.onnx_data' — shared by both the text graph AND the vision graph. */
  baseWeightsFile: string;
  /** e.g. 'adapters/souffleur-chat-0.3.0.data' */
  adapterFile: string;
  /**
   * `model_file_name` for transformers.js: 'model_vision' when the grafted
   * graph is published (it's bit-identical in text, so it's used for
   * everything), 'model' otherwise. Resolved by the manifest.
   */
  modelFileName?: string;
}

/** The vision tower, as described by the manifest. */
export interface TowerFiles {
  /** Absolute URL of the tower's graph. */
  graphUrl: string;
  /** Absolute URL of its versioned external data. */
  dataUrl: string;
  /** External data name registered INSIDE the graph (to be mapped onto dataUrl). */
  internalDataName: string;
  /** Exact size of a souffleur `.data` — template for the neutral adapter. */
  adapterByteLength: number;
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
      /** Console trace (ids of the first tokens — double-BOS check, etc.). */
      debug?: boolean;
    } & AdapterFiles)
  | ({
      /**
       * read_file(image) — swap to the vision "role": SAME graph, SAME
       * weights, only `adapter.data` changes (neutral, allocated locally) and
       * the tower attaches in a separate session. So mechanically, this is a
       * souffleur swap — cf. CONTRACT-HANDOFF §1: "hot-swap encoder + describe
       * call, no LoRA to train (architectural)".
       */
      type: 'describe-image';
      id: number;
      device: ComputeDevice;
      blob: Blob;
      question: string;
      maxNewTokens: number;
      tower: TowerFiles;
      /** Tile cap for the preprocessing (see PreprocessOptions.maxTiles). */
      maxTiles?: number;
      debug?: boolean;
    } & AdapterFiles)
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
