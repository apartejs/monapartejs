/**
 * SouffleursProvider — AparteAIProvider « own-I/O » pour le modèle aparté
 * (HF maxituc/aparte-souffleurs). Candidat plugin @aparte/provider-souffleurs.
 *
 * - Un seul pipeline navigateur (worker dédié) : toute opération (chat caller,
 *   préchargement, exécuteur) passe par une file d'attente unique.
 * - Déclare `function_calling` : AparteClient envoie alors les AparteTool
 *   enregistrés — utilisés ici comme LISTE D'ACTIVATION par nom ; le schéma
 *   sérialisé sur le fil vient de SOUFFLEUR_TOOL_DEFS (contrat d'entraînement).
 * - Les fichiers joints arrivent via request._meta.souffleurFiles (posé par un
 *   requestInterceptor côté app, avec rawFileInject:'none').
 */
import type {
  AparteAIModel,
  AparteAIProvider,
  AparteChatRequest,
  AparteChatResponse,
  AparteStreamEvent,
  ModelLoadProgress,
  ModelStatus,
} from '@aparte/core';

type ProviderMetadata = ReturnType<AparteAIProvider['getMetadata']>;
import {
  CALLER_ADAPTER,
  CALLER_DOWNLOAD_BYTES,
  CALLER_MAX_NEW_TOKENS,
  CALLER_MODEL_ID,
  EXECUTOR_MAX_NEW_TOKENS,
  SOUFFLEURS_HF_REPO,
  type AdapterName,
} from './model-catalog';
import { setSouffleurStatus } from './status';
import { buildSystemPrompt, type SouffleurFileRef } from './wire/system-prompt';
import { buildWirePrompt } from './wire/prompt-builder';
import { UNPARSEABLE, parsePythonicOutput } from './wire/pythonic-parser';
import { WireStreamDemux } from './wire/stream-demux';
import type {
  ComputeDevice,
  MainToWorker,
  WorkerFileProgress,
  WorkerToMain,
} from './worker-protocol';

/**
 * Canal fichiers : l'app pose `request._meta['souffleurFiles']` (via un
 * requestInterceptor, J3) — transmis intact par DirectTransport aux providers
 * own-I/O. Clé documentée ici, lue nulle part ailleurs.
 */
export const META_FILES_KEY = 'souffleurFiles';

const PROVIDER_ID = 'souffleurs';

interface PendingHandlers {
  onProgress?: (p: WorkerFileProgress) => void;
  onReady?: (adapter: AdapterName, ms: number) => void;
  onChunk?: (delta: string) => void;
  onDone?: (usage: {
    inputTokens: number;
    outputTokens: number;
    ttftMs: number;
    durationMs: number;
  }) => void;
  onError?: (message: string) => void;
}

let _worker: Worker | null = null;
let _nextId = 1;
let _chain: Promise<unknown> = Promise.resolve();
let _device: ComputeDevice | null = null;
let _loadedAdapter: AdapterName | null = null;
const _pending = new Map<number, PendingHandlers>();

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('./souffleurs.worker', import.meta.url), { type: 'module' });
    _worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const msg = event.data;
      const handlers = _pending.get(msg.id);
      switch (msg.type) {
        case 'progress':
          handlers?.onProgress?.(msg);
          break;
        case 'ready':
          _loadedAdapter = msg.adapter;
          handlers?.onReady?.(msg.adapter, msg.ms);
          break;
        case 'chunk':
          handlers?.onChunk?.(msg.delta);
          break;
        case 'done':
          handlers?.onDone?.(msg.usage);
          _pending.delete(msg.id);
          break;
        case 'error':
          handlers?.onError?.(msg.message);
          _pending.delete(msg.id);
          break;
      }
    };
  }
  return _worker;
}

/** Détection RÉELLE de WebGPU (requestAdapter, pas juste `'gpu' in navigator`). */
export async function detectComputeDevice(): Promise<ComputeDevice> {
  if (_device) return _device;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    _device = adapter ? 'webgpu' : 'wasm';
  } catch {
    _device = 'wasm';
  }
  return _device;
}

/** File d'attente unique : un seul pipeline, une seule opération à la fois. */
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = _chain.then(op, op);
  _chain = run.catch(() => undefined);
  return run;
}

function genCallId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `call_${Date.now()}_${_nextId++}`;
}

const MODELS: AparteAIModel[] = [
  {
    id: CALLER_MODEL_ID,
    name: 'aparté (local)',
    capabilities: ['streaming', 'function_calling'],
    description: 'Souffleur-chat — tourne entièrement dans votre navigateur, rien ne sort de votre appareil.',
  },
];

export const SouffleursProvider: AparteAIProvider = {
  id: PROVIDER_ID,

  getMetadata(): ProviderMetadata {
    return {
      id: PROVIDER_ID,
      name: 'aparté',
      description: 'Souffleurs locaux (WebGPU/WASM) — 100 % navigateur',
      color: 'var(--aparte-primary)',
    };
  },

  // SYNCHRONE obligatoirement : AparteConfig.getCurrentModel() ignore les Promise,
  // et sans modèle courant le gate function_calling coupe les tools.
  getModels(): AparteAIModel[] {
    return MODELS;
  },

  async chat(request: AparteChatRequest): Promise<AparteChatResponse> {
    const device = await detectComputeDevice();
    const enabledTools = request.tools?.map((t) => t.name) ?? [];
    const files =
      (request._meta?.[META_FILES_KEY] as SouffleurFileRef[] | undefined) ?? [];
    const system = buildSystemPrompt(enabledTools, files);
    const prompt = buildWirePrompt(system, request.messages);
    const maxNewTokens = Math.max(request.maxTokens ?? 0, CALLER_MAX_NEW_TOKENS);

    let raw = '';
    const demux = new WireStreamDemux();

    return new ReadableStream<AparteStreamEvent>({
      start: (controller) => {
        const emitDemux = (deltas: ReturnType<WireStreamDemux['push']>) => {
          for (const ev of deltas) {
            controller.enqueue(
              ev.kind === 'text'
                ? { type: 'text', delta: ev.delta }
                : { type: 'thinking', delta: ev.delta },
            );
          }
        };

        setSouffleurStatus({
          status: _loadedAdapter === CALLER_ADAPTER ? 'generating' : 'loading',
          device,
        });

        void enqueue(
          () =>
            new Promise<void>((resolve) => {
              const id = _nextId++;
              _pending.set(id, {
                onChunk: (delta) => {
                  raw += delta;
                  emitDemux(demux.push(delta));
                },
                onDone: (usage) => {
                  emitDemux(demux.flush());
                  const parsed = parsePythonicOutput(raw);
                  for (const call of parsed.calls) {
                    if (call.name === UNPARSEABLE) {
                      console.warn('[souffleurs] tool_call imparsable ignoré:', call.args['raw']);
                      continue;
                    }
                    controller.enqueue({
                      type: 'tool_use',
                      id: genCallId(),
                      name: call.name,
                      input: call.args,
                    });
                  }
                  controller.enqueue({ type: 'done', usage });
                  setSouffleurStatus({ status: 'ready', device });
                  controller.close();
                  resolve();
                },
                onError: (message) => {
                  controller.enqueue({ type: 'error', message });
                  setSouffleurStatus({ status: 'error', message, device });
                  controller.close();
                  resolve();
                },
              });
              getWorker().postMessage({
                type: 'generate',
                id,
                adapter: CALLER_ADAPTER,
                device,
                prompt,
                maxNewTokens,
              } satisfies MainToWorker);
            }),
        );
      },
      cancel: () => {
        getWorker().postMessage({ type: 'abort' } satisfies MainToWorker);
      },
    });
  },

  async getModelStatus(_modelId: string): Promise<ModelStatus> {
    if (_loadedAdapter === CALLER_ADAPTER) return 'ready';
    try {
      if (typeof caches === 'undefined') return 'not-downloaded';
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      const has = (fragment: string) => keys.some((req) => req.url.includes(fragment));
      return has('model_q4.onnx_data') && has(`${CALLER_ADAPTER}.data`)
        ? 'cached'
        : 'not-downloaded';
    } catch {
      return 'not-downloaded';
    }
  },

  async prepareModel(
    _modelId: string,
    onProgress: (p: ModelLoadProgress) => void,
  ): Promise<void> {
    const device = await detectComputeDevice();
    return enqueue(
      () =>
        new Promise<void>((resolve, reject) => {
          const id = _nextId++;
          const files = new Map<string, { loaded: number; total: number }>();
          _pending.set(id, {
            onProgress: (p) => {
              files.set(p.file, {
                loaded: p.done ? p.total || p.loaded : p.loaded,
                total: p.total || p.loaded,
              });
              let loaded = 0;
              let total = 0;
              for (const f of files.values()) {
                loaded += f.loaded;
                total += f.total;
              }
              // Dénominateur plancher = taille attendue base+adapter : la
              // progression reste honnête même avant que tous les fichiers
              // n'aient annoncé leur taille.
              const progress = Math.min(
                99,
                Math.round((loaded / Math.max(total, CALLER_DOWNLOAD_BYTES)) * 100),
              );
              setSouffleurStatus({ status: 'downloading', progress, device });
              onProgress({ status: 'downloading', file: p.file, progress });
            },
            onReady: () => {
              _pending.delete(id);
              setSouffleurStatus({ status: 'ready', device });
              onProgress({ status: 'ready', progress: 100 });
              resolve();
            },
            onError: (message) => {
              setSouffleurStatus({ status: 'error', message, device });
              onProgress({ status: 'error', message });
              reject(new Error(message));
            },
          });
          getWorker().postMessage({
            type: 'prepare',
            id,
            adapter: CALLER_ADAPTER,
            device,
          } satisfies MainToWorker);
        }),
    );
  },

  async deleteModel(_modelId: string): Promise<void> {
    getWorker().postMessage({ type: 'dispose' } satisfies MainToWorker);
    _loadedAdapter = null;
    try {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      await Promise.all(
        keys
          .filter((req) => req.url.includes(SOUFFLEURS_HF_REPO))
          .map((req) => cache.delete(req)),
      );
    } catch {
      // cache indisponible : rien à effacer
    }
    setSouffleurStatus({ status: 'not-downloaded' });
  },
};

/* ── Surface étendue (hors AparteAIProvider) ─────────────────────────────── */

export type ExecutorAdapter = Exclude<AdapterName, 'souffleur-chat'>;

export interface ExecutorResult {
  raw: string;
  usage: { inputTokens: number; outputTokens: number; ttftMs: number; durationMs: number };
}

/**
 * Exécute un souffleur exécuteur (pdf / xlsx-docx / sandbox) — J3.
 * Passe par la MÊME file d'attente que le caller (un seul pipeline, swap ≈ 3,8 s).
 * Invisible pour la boucle AparteClient : un aller-retour exécuteur = zéro tour agentique.
 */
export async function runExecutor(
  adapter: ExecutorAdapter,
  systemPrompt: string,
  task: string,
  opts: { maxNewTokens?: number } = {},
): Promise<ExecutorResult> {
  const device = await detectComputeDevice();
  const prompt = buildWirePrompt(systemPrompt, [{ role: 'user', content: task }]);
  return enqueue(
    () =>
      new Promise<ExecutorResult>((resolve, reject) => {
        const id = _nextId++;
        let raw = '';
        _pending.set(id, {
          onChunk: (delta) => {
            raw += delta;
          },
          onDone: (usage) => resolve({ raw: raw.split('<|im_end|>')[0], usage }),
          onError: (message) => reject(new Error(message)),
        });
        getWorker().postMessage({
          type: 'generate',
          id,
          adapter,
          device,
          prompt,
          maxNewTokens: opts.maxNewTokens ?? EXECUTOR_MAX_NEW_TOKENS,
        } satisfies MainToWorker);
      }),
  );
}
