/**
 * SouffleursProvider — "own-I/O" AparteAIProvider for the aparté model
 * (HF apartejs/aparte-souffleurs). Candidate @aparte/provider-souffleurs plugin.
 *
 * - A single browser pipeline (dedicated worker): every operation (caller
 *   chat, prefetch, executor) goes through a single queue.
 * - Declares `function_calling`: AparteClient then sends the registered
 *   AparteTool — used here as an ACTIVATION LIST by name; the schema
 *   serialized on the wire comes from SOUFFLEUR_TOOL_DEFS (training contract).
 * - Attached files arrive via request._meta.souffleurFiles (set by a
 *   requestInterceptor on the app side, with rawFileInject:'none').
 */
import type {
  AparteAIModel,
  AparteAIProvider,
  AparteAIProviderMetadata,
  AparteChatRequest,
  AparteChatResponse,
  AparteStreamEvent,
  ModelLoadProgress,
  ModelStatus,
} from '@aparte/core';

import {
  CALLER_ADAPTER,
  CALLER_DOWNLOAD_BYTES,
  CALLER_CONTEXT_WINDOW,
  CALLER_MAX_NEW_TOKENS,
  CALLER_MODEL_ID,
  EXECUTOR_MAX_NEW_TOKENS,
  SIZE_ADAPTER_BYTES,
  SOUFFLEURS_HF_REPO,
  VISION_MAX_NEW_TOKENS,
  type AdapterName,
} from './model-catalog';
import { adapterRole, getSouffleurManifest } from './manifest';
import { ProgressAggregator } from './progress-aggregator';
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
 * Files channel: the app sets `request._meta['souffleurFiles']` (via a
 * requestInterceptor, J3) — passed through unchanged by DirectTransport to
 * own-I/O providers. Key documented here, read nowhere else.
 */
export const META_FILES_KEY = 'souffleurFiles';

const PROVIDER_ID = 'souffleurs';

/**
 * Last exchange ACTUALLY sent on the wire, captured unconditionally (two
 * strings, zero cost). Used for diagnostics outside the console: /debug/prompt
 * displays it. It's the only way to answer "is the List of tools block there?"
 * other than trusting an assumption.
 */
let _lastWire: { prompt: string; raw: string; at: number } | null = null;

export function getLastWire(): { prompt: string; raw: string; at: number } | null {
  return _lastWire;
}

interface PendingHandlers {
  onProgress?: (p: WorkerFileProgress) => void;
  onReady?: (adapter: AdapterName | 'vision', ms: number) => void;
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
          // 'vision' is not an adapter: the VL trio has taken the place of the
          // text pipe, so no adapter is loaded anymore.
          _loadedAdapter = msg.adapter === 'vision' ? null : msg.adapter;
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

/** ACTUAL WebGPU detection (requestAdapter, not just `'gpu' in navigator`). */
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

/** Single queue: one pipeline, one operation at a time. */
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = _chain.then(op, op);
  _chain = run.catch(() => undefined);
  return run;
}

/**
 * Default verbosity, INJECTED (this module doesn't know Angular, so no
 * `isDevMode()`): the app sets it to `isDevMode()` at boot. In dev we're
 * verbose without having to enable anything — that's the mode where we debug.
 */
let _debugDefault = false;

export function setSouffleurDebug(enabled: boolean): void {
  _debugDefault = enabled;
}

/**
 * `bp.debug` remains an explicit OVERRIDE, in both directions:
 *   '1' → forces traces on (useful on a prod build)
 *   '0' → silences them (useful when dev is too noisy)
 * absent → follows the app's mode.
 */
function isDebug(): boolean {
  try {
    const flag = localStorage.getItem('bp.debug');
    if (flag === '1') return true;
    if (flag === '0') return false;
  } catch {
    /* storage unavailable: follows the default */
  }
  return _debugDefault;
}

/** Resolves an adapter's versioned files via the manifest (+ markSeen after ready). */
async function resolveAdapterFiles(adapter: AdapterName) {
  const manifest = await getSouffleurManifest();
  const role = adapterRole(adapter);
  return {
    files: {
      baseWeightsFile: manifest.baseWeightsFile(),
      adapterFile: manifest.file(role),
      // The grafted graph is bit-identical in text (measured logits gap: 0)
      // — so it's used for EVERYTHING once published, and text/vision then
      // only differ by `adapter.data`, like a souffleur swap.
      modelFileName: manifest.modelFileName(),
    },
    size: manifest.size(role) ?? SIZE_ADAPTER_BYTES,
    markSeen: () => manifest.markSeen(role),
  };
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
    // The base model's window. Declared because <aparte-context> draws nothing
    // without one, and the compaction selector budgets against it. It is the
    // model's MAXIMUM, not a comfortable size in a browser: we rebuild the whole
    // wire prompt every turn and reuse no KV cache, so a conversation near this
    // window re-prefills it at every send — on WASM for anyone without WebGPU.
    // The gauge exists to make that cost visible before it is paid.
    contextWindow: CALLER_CONTEXT_WINDOW,
    description:
      'Souffleur-chat — tourne entièrement dans votre navigateur, rien ne sort de votre appareil.',
  },
];

export const SouffleursProvider: AparteAIProvider = {
  id: PROVIDER_ID,

  getMetadata(): AparteAIProviderMetadata {
    return {
      id: PROVIDER_ID,
      name: 'aparté',
      description: 'Souffleurs locaux (WebGPU/WASM) — 100 % navigateur',
      color: 'var(--aparte-primary)',
    };
  },

  // MUST be SYNCHRONOUS: aparteGlobalConfig.getCurrentModel() ignores Promises,
  // and without a current model the function_calling gate cuts off the tools.
  getModels(): AparteAIModel[] {
    return MODELS;
  },

  async chat(request: AparteChatRequest): Promise<AparteChatResponse> {
    const device = await detectComputeDevice();
    const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
    const enabledTools = request.tools?.map((t) => t.name) ?? [];
    const files = (request._meta?.[META_FILES_KEY] as SouffleurFileRef[] | undefined) ?? [];
    const system = buildSystemPrompt(enabledTools, files);
    const prompt = buildWirePrompt(system, request.messages);
    const maxNewTokens = Math.max(request.maxTokens ?? 0, CALLER_MAX_NEW_TOKENS);
    // Diagnostics: on by default in dev (see setSouffleurDebug) — exact wire
    // prompt, raw output and parsed calls in the console, + ids on the worker
    // side. `localStorage.setItem('bp.debug','0')` silences, '1' forces in prod.
    const debug = isDebug();

    let raw = '';
    const demux = new WireStreamDemux();
    _lastWire = { prompt, raw: '', at: Date.now() };

    // Cancellation: the consumer closes the controller BEFORE the worker has
    // finished its turn (`stopping.interrupt()` is only seen on the next
    // token). Without this flag, the late `done` would call enqueue() on a
    // closed stream → TypeError INSIDE onmessage, so `resolve()` never
    // reached and `_chain` stuck forever (no MORE generation after that).
    let closed = false;

    return new ReadableStream<AparteStreamEvent>({
      start: (controller) => {
        const emit = (ev: AparteStreamEvent) => {
          if (!closed) controller.enqueue(ev);
        };
        const finish = () => {
          if (closed) return;
          closed = true;
          controller.close();
        };
        const emitDemux = (deltas: ReturnType<WireStreamDemux['push']>) => {
          for (const ev of deltas) {
            emit(
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
                onReady: () => resolved.markSeen(),
                onChunk: (delta) => {
                  raw += delta;
                  emitDemux(demux.push(delta));
                },
                onDone: (usage) => {
                  emitDemux(demux.flush());
                  if (_lastWire) _lastWire.raw = raw;
                  const parsed = parsePythonicOutput(raw);
                  if (debug) {
                    console.log('[souffleurs] PROMPT WIRE >>>\n%s', prompt);
                    console.log('[souffleurs] RAW OUTPUT >>>\n%s', raw);
                    console.log('[souffleurs] PARSED >>>', parsed);
                  }
                  // Turn cancelled: do NOT trigger the tools the model had
                  // started announcing (emit() is already neutralized).
                  if (!closed) {
                    for (const call of parsed.calls) {
                      if (call.name === UNPARSEABLE) {
                        console.warn(
                          '[souffleurs] unparseable tool_call ignored:',
                          call.args['raw'],
                        );
                        continue;
                      }
                      emit({
                        type: 'tool_use',
                        id: genCallId(),
                        name: call.name,
                        input: call.args,
                      });
                    }
                  }
                  emit({ type: 'done', usage });
                  setSouffleurStatus({ status: 'ready', device });
                  finish();
                  resolve();
                },
                onError: (message) => {
                  emit({ type: 'error', message });
                  setSouffleurStatus({ status: 'error', message, device });
                  finish();
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
                debug,
                ...resolved.files,
              } satisfies MainToWorker);
            }),
        );
      },
      cancel: () => {
        // The stream is ALREADY closed by the consumer: no more enqueue or
        // close() (both would throw). The `_pending` handler stays in place
        // so that the worker's `done`/`error` resolves the queue (`_chain`).
        closed = true;
        setSouffleurStatus({ status: 'ready', device });
        getWorker().postMessage({ type: 'abort' } satisfies MainToWorker);
      },
    });
  },

  async getModelStatus(_modelId: string): Promise<ModelStatus> {
    if (_loadedAdapter === CALLER_ADAPTER) return 'ready';
    try {
      if (typeof caches === 'undefined') return 'not-downloaded';
      const manifest = await getSouffleurManifest();
      const basename = (path: string) => path.split('/').pop() ?? path;
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      const has = (fragment: string) => keys.some((req) => req.url.includes(fragment));
      // Files of the manifest's CURRENT version: a bumped version shows up as
      // not-downloaded (the onboarding/modal re-downloads).
      return has(basename(manifest.baseWeightsFile())) && has(basename(manifest.file('chat')))
        ? 'cached'
        : 'not-downloaded';
    } catch {
      return 'not-downloaded';
    }
  },

  async prepareModel(_modelId: string, onProgress: (p: ModelLoadProgress) => void): Promise<void> {
    const device = await detectComputeDevice();
    const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
    return enqueue(
      () =>
        new Promise<void>((resolve, reject) => {
          const id = _nextId++;
          const aggregator = new ProgressAggregator(CALLER_DOWNLOAD_BYTES);
          _pending.set(id, {
            onProgress: (p) => {
              const progress = aggregator.push(p);
              setSouffleurStatus({ status: 'downloading', progress, device });
              onProgress({ status: 'downloading', file: p.file, progress });
            },
            onReady: () => {
              _pending.delete(id);
              resolved.markSeen();
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
            ...resolved.files,
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
        keys.filter((req) => req.url.includes(SOUFFLEURS_HF_REPO)).map((req) => cache.delete(req)),
      );
    } catch {
      // cache unavailable: nothing to erase
    }
    setSouffleurStatus({ status: 'not-downloaded' });
  },
};

/* ── Extended surface (outside AparteAIProvider) ─────────────────────────── */

export type ExecutorAdapter = Exclude<AdapterName, 'souffleur-chat'>;

export interface ExecutorResult {
  raw: string;
  usage: { inputTokens: number; outputTokens: number; ttftMs: number; durationMs: number };
}

/* ── Vision: encoder hot-swap ─────────────────────────────────────────────── */

/**
 * read_file(image) — attaches the ENCODER and queries the image.
 *
 * Goes through the SAME queue as the souffleurs: mechanically this is a role
 * swap (same graph, same weights, neutral `adapter.data`) plus a tower
 * session. The rendered text goes back as a tool result and souffleur-chat
 * continues — it stays text-only and never sees pixels (contract rule).
 *
 * Throws if the `vision` block isn't in the manifest: the read_file handler
 * turns this into `ok:false` with the message, now shown to the user.
 */
/**
 * Tile cap for image preprocessing — default 1 (mono-tile, ≤ 256 tokens).
 * Multi-tile is the reference's path for fine text but was measured
 * unusable in the browser (see PreprocessOptions.maxTiles). Switch to
 * measure it: `localStorage.setItem('bp.vision.tiles', '4')` then reload.
 */
function visionMaxTiles(): number {
  try {
    const raw = Number(localStorage.getItem('bp.vision.tiles'));
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  } catch {
    return 1;
  }
}

export async function describeImage(blob: Blob, question: string): Promise<string> {
  const device = await detectComputeDevice();
  const manifest = await getSouffleurManifest();
  const vision = manifest.vision();
  if (!vision) {
    throw new Error(
      "analyse d'image indisponible : l'encodeur vision n'est pas publié pour cette version du modèle",
    );
  }
  const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
  const base = `https://huggingface.co/${SOUFFLEURS_HF_REPO}/resolve/main`;
  const debug = isDebug();

  setSouffleurStatus({ status: 'loading', device });
  return enqueue(
    () =>
      new Promise<string>((resolve, reject) => {
        const id = _nextId++;
        const aggregator = new ProgressAggregator(vision.size);
        let text = '';
        _pending.set(id, {
          onProgress: (p) =>
            setSouffleurStatus({ status: 'downloading', progress: aggregator.push(p), device }),
          onReady: () => setSouffleurStatus({ status: 'generating', device }),
          onChunk: (delta) => {
            text += delta;
          },
          onDone: () => {
            _pending.delete(id);
            // The vision role occupies the slot: the souffleur will reload on
            // the next turn (same invariant as an executor swap).
            _loadedAdapter = null;
            setSouffleurStatus({ status: 'ready', device });
            resolve(text.trim());
          },
          onError: (message) => {
            _pending.delete(id);
            _loadedAdapter = null;
            setSouffleurStatus({ status: 'error', message, device });
            reject(new Error(message));
          },
        });
        getWorker().postMessage({
          type: 'describe-image',
          id,
          device,
          blob,
          question,
          maxNewTokens: VISION_MAX_NEW_TOKENS,
          maxTiles: visionMaxTiles(),
          tower: {
            graphUrl: `${base}/${vision.tower}`,
            dataUrl: `${base}/${vision.tower_data}`,
            internalDataName: vision.tower_internal_data,
            // Template for the neutral adapter: exactly the size of a
            // souffleur `.data`, allocated on the worker side (zero network bytes).
            adapterByteLength: manifest.size(adapterRole(CALLER_ADAPTER)) ?? SIZE_ADAPTER_BYTES,
          },
          debug,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}

/** Preloads an executor adapter (86 MB, shared base already cached). */
export async function prepareExecutor(
  adapter: ExecutorAdapter,
  onProgress?: (p: ModelLoadProgress) => void,
): Promise<void> {
  const device = await detectComputeDevice();
  const resolved = await resolveAdapterFiles(adapter);
  return enqueue(
    () =>
      new Promise<void>((resolve, reject) => {
        const id = _nextId++;
        const aggregator = new ProgressAggregator(resolved.size);
        _pending.set(id, {
          onProgress: (p) =>
            onProgress?.({ status: 'downloading', file: p.file, progress: aggregator.push(p) }),
          onReady: () => {
            _pending.delete(id);
            resolved.markSeen();
            resolve();
          },
          onError: (message) => reject(new Error(message)),
        });
        getWorker().postMessage({
          type: 'prepare',
          id,
          adapter,
          device,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}

/** Reloads the caller into the pipeline (after an executor prefetch). */
export async function prepareCaller(): Promise<void> {
  const device = await detectComputeDevice();
  const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
  return enqueue(
    () =>
      new Promise<void>((resolve, reject) => {
        const id = _nextId++;
        _pending.set(id, {
          onReady: () => {
            _pending.delete(id);
            resolve();
          },
          onError: (message) => reject(new Error(message)),
        });
        getWorker().postMessage({
          type: 'prepare',
          id,
          adapter: CALLER_ADAPTER,
          device,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}

/**
 * Runs an executor souffleur (pdf / xlsx-docx / sandbox) — J3.
 * Goes through the SAME queue as the caller (a single pipeline, swap ≈ 3.8 s).
 * Invisible to the AparteClient loop: an executor round trip = zero agentic turn.
 */
export async function runExecutor(
  adapter: ExecutorAdapter,
  systemPrompt: string,
  task: string,
  opts: { maxNewTokens?: number; onChunk?: (raw: string) => void; signal?: AbortSignal } = {},
): Promise<ExecutorResult> {
  const abortError = () => {
    const err = new Error('executor aborted');
    err.name = 'AbortError';
    return err;
  };
  if (opts.signal?.aborted) throw abortError();
  const device = await detectComputeDevice();
  const resolved = await resolveAdapterFiles(adapter);
  // `intent: ` prefix — TRAINING FORMAT of the three executors (100% of
  // examples: pdf 1228/1228, xlsx-docx 1056/1056, sandbox 1492/1492, lab
  // audit of 07/26, HANDOFF-fixes-bonaparte §1), and what the lab executor
  // does (`browser/app/executor.js`: `intent: ${args.intent}`). The app was
  // sending the bare task: every file generation was out of distribution.
  const prompt = buildWirePrompt(systemPrompt, [{ role: 'user', content: `intent: ${task}` }]);
  // Visible cycle (mascot/badge): loading during the swap, generating while
  // the executor produces output, ready on return.
  setSouffleurStatus({ status: 'loading', device });
  return enqueue(
    () =>
      new Promise<ExecutorResult>((resolve, reject) => {
        // Stop pressed while queued: do not even start the generation.
        if (opts.signal?.aborted) {
          reject(abortError());
          return;
        }
        const id = _nextId++;
        let raw = '';
        // The conversation's Stop button aborts the chat stream, and the
        // engine forwards that abort to the running tool handler's signal.
        // Until now nothing listened here: the executor kept generating in
        // the worker (seen 2026-08-28 on a souffleur-pdf loop — minutes of
        // GPU after Stop). One pipeline, one `abort`: interrupting the worker
        // interrupts whatever is generating, which is this executor.
        const onAbort = () => {
          getWorker().postMessage({ type: 'abort' } satisfies MainToWorker);
          setSouffleurStatus({ status: 'ready', device });
          reject(abortError());
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });
        const settle = () => opts.signal?.removeEventListener('abort', onAbort);
        _pending.set(id, {
          onProgress: (p) => {
            if (!p.done) setSouffleurStatus({ status: 'downloading', device });
          },
          onReady: () => {
            resolved.markSeen();
            setSouffleurStatus({ status: 'generating', device });
          },
          onChunk: (delta) => {
            raw += delta;
            opts.onChunk?.(raw);
          },
          onDone: (usage) => {
            settle();
            setSouffleurStatus({ status: 'ready', device });
            if (isDebug()) {
              // Same traces as the caller: without them a "code crashed"
              // tool error is undiagnosable (seen 2026-08-28, jsPDF.text).
              console.log('[souffleurs] EXECUTOR %s PROMPT >>>\n%s', adapter, prompt);
              console.log('[souffleurs] EXECUTOR %s RAW >>>\n%s', adapter, raw);
            }
            resolve({ raw: raw.split('<|im_end|>')[0], usage });
          },
          onError: (message) => {
            settle();
            setSouffleurStatus({ status: 'error', message, device });
            reject(new Error(message));
          },
        });
        getWorker().postMessage({
          type: 'generate',
          id,
          adapter,
          device,
          prompt,
          maxNewTokens: opts.maxNewTokens ?? EXECUTOR_MAX_NEW_TOKENS,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}
