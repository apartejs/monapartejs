import type { AdapterName } from './model-catalog';

/** Protocole main ↔ worker (un seul pipeline en mémoire, adapter hot-swappé). */

export type ComputeDevice = 'webgpu' | 'wasm';

/** Fichiers résolus par le manifest (noms versionnés immuables). */
export interface AdapterFiles {
  /** ex. 'onnx/model_q4.onnx_data' — partagé par le graphe texte ET le graphe vision. */
  baseWeightsFile: string;
  /** ex. 'adapters/souffleur-chat-0.3.0.data' */
  adapterFile: string;
  /**
   * `model_file_name` pour transformers.js : 'model_vision' quand le graphe
   * greffé est publié (il est bit-identique en texte, on l'utilise pour tout),
   * 'model' sinon. Résolu par le manifest.
   */
  modelFileName?: string;
}

/** La tour vision, telle que le manifest la décrit. */
export interface TowerFiles {
  /** URL absolue du graphe de la tour. */
  graphUrl: string;
  /** URL absolue de son external data versionnée. */
  dataUrl: string;
  /** Nom d'external data inscrit DANS le graphe (à mapper sur dataUrl). */
  internalDataName: string;
  /** Taille exacte d'un `.data` de souffleur — gabarit de l'adapter neutre. */
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
      /** Trace console (ids des premiers tokens — contrôle double-BOS, etc.). */
      debug?: boolean;
    } & AdapterFiles)
  | {
      /**
       * read_file(image) — swap vers le « rôle » vision : MÊME graphe, MÊMES
       * poids, seul `adapter.data` change (neutre, alloué localement) et la
       * tour se rattache en session à part. C'est donc, mécaniquement, un swap
       * de souffleur — cf. CONTRACT-HANDOFF §1 : « hot-swap encodeur + appel
       * describe, pas de LoRA à entraîner (architectural) ».
       */
      type: 'describe-image';
      id: number;
      device: ComputeDevice;
      blob: Blob;
      question: string;
      maxNewTokens: number;
      tower: TowerFiles;
      debug?: boolean;
    } & AdapterFiles
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
