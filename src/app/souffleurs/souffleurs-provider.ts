/**
 * SouffleursProvider — "own-I/O" AparteAIProvider for the aparté model
 * (HF apartejs/aparte-souffleurs).
 *
 * - A single model in memory, run by the wllama engine (ADR-014): every
 *   operation (caller chat, prefetch, executor, image) goes through one queue.
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

import { CacheManager } from '@wllama/wllama';
import {
  CALLER_ADAPTER,
  CALLER_DOWNLOAD_BYTES,
  CALLER_CONTEXT_WINDOW,
  CALLER_MAX_NEW_TOKENS,
  CALLER_MODEL_ID,
  EXECUTOR_MAX_NEW_TOKENS,
  SIZE_ADAPTER_BYTES,
  SIZE_MMPROJ_BYTES,
  VISION_MAX_NEW_TOKENS,
  souffleursBaseUrl,
  type AdapterName,
} from './model-catalog';
import { createDefaultEngine } from './engine/wllama-engine';
import { adapterRole, getSouffleurManifest, type SouffleurRole } from './manifest';
import { ProgressAggregator } from './progress-aggregator';
import { getSouffleurStatus, setSouffleurStatus, type SouffleurStatusState } from './status';
import type { SouffleurFileRef } from './wire/system-prompt';
import {
  lfm3SystemPrompt,
  lfm3Tools,
  parseCallArguments,
  toChatMessages,
  type ChatMessage,
} from './wire/chat-wire';
import type { Lfm3Tool } from './wire/contract-lfm3';
import type {
  ComputeDevice,
  EngineLike,
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
  onToolStart?: (name: string) => void;
  onDone?: (
    usage: {
      inputTokens: number;
      outputTokens: number;
      ttftMs: number;
      durationMs: number;
    },
    toolCalls?: { name: string; arguments: string }[],
  ) => void;
  onError?: (message: string) => void;
}

let _worker: EngineLike | null = null;
let _nextId = 1;
let _chain: Promise<unknown> = Promise.resolve();
let _device: ComputeDevice | null = null;
let _loadedAdapter: AdapterName | null = null;
const _pending = new Map<number, PendingHandlers>();

function attach(engine: EngineLike): EngineLike {
  engine.onmessage = (event: { data: WorkerToMain }) => {
    const msg = event.data;
    const handlers = _pending.get(msg.id);
    switch (msg.type) {
      case 'progress':
        handlers?.onProgress?.(msg);
        break;
      case 'ready':
        // 'vision' is not an adapter: the base without adapter (+ mmproj) has
        // taken the place of the souffleur, so no adapter is loaded anymore.
        _loadedAdapter = msg.adapter === 'vision' ? null : msg.adapter;
        handlers?.onReady?.(msg.adapter, msg.ms);
        break;
      case 'chunk':
        handlers?.onChunk?.(msg.delta);
        break;
      case 'tool-start':
        handlers?.onToolStart?.(msg.name);
        break;
      case 'done':
        handlers?.onDone?.(msg.usage, msg.toolCalls);
        _pending.delete(msg.id);
        break;
      case 'error':
        handlers?.onError?.(msg.message);
        _pending.delete(msg.id);
        break;
    }
  };
  return engine;
}

function getWorker(): EngineLike {
  if (!_worker) _worker = attach(createDefaultEngine(souffleursBaseUrl()));
  return _worker;
}

/** Test seam: the engine behind getWorker(). */
export function __setEngineForTests(engine: EngineLike | null): void {
  _worker = engine ? attach(engine) : null;
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

/** Single queue: one pipeline, one operation at a time. Any operation stops a read-ahead (see `readAhead`). */
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  stopReadAhead();
  return queue(op);
}

function queue<T>(op: () => Promise<T>): Promise<T> {
  const run = _chain.then(op, op);
  _chain = run.catch(() => undefined);
  return run;
}

/**
 * The files the conversation's next request will list, from the app (the same source as its request
 * interceptor). Unset, nothing is read ahead.
 */
let _nextTurnFiles: (() => SouffleurFileRef[]) | null = null;

export function setNextTurnFiles(source: (() => SouffleurFileRef[]) | null): void {
  _nextTurnFiles = source;
}

/** The read-ahead queued or running, if any: stopped by the next operation, before or after it is posted. */
let _readAhead: { cancelled: boolean; posted: boolean } | null = null;

function stopReadAhead(): void {
  const running = _readAhead;
  if (!running) return;
  _readAhead = null;
  running.cancelled = true;
  if (running.posted) getWorker().postMessage({ type: 'abort' } satisfies MainToWorker);
}

/**
 * Reads the next turn's prompt ahead, after a final answer that changed the conversation's files (6/11, M5).
 * A document the model produced joins "Files available" at the next user turn — the F16 edit rows train on it
 * there — so the system message changes, and the template puts the 1,600 tokens of tools after it: the
 * follow-up re-read its whole prompt, 45 s with the M5's GPU, 136 s without. The prompt is the turn just
 * answered with the new system message; its generation prompt opens the answer's own turn, so the follow-up
 * finds all of it in the cache. It runs while the user reads the document, silently (no status): the next
 * operation stops it, and llama.cpp keeps the batches already read for whatever shares them.
 */
function readAhead(
  files: readonly SouffleurFileRef[],
  history: AparteChatRequest['messages'],
  tools: Lfm3Tool[],
  device: ComputeDevice,
  adapterFiles: Awaited<ReturnType<typeof resolveAdapterFiles>>['files'],
): void {
  const next = _nextTurnFiles?.();
  if (!next) return;
  const system = lfm3SystemPrompt(next);
  if (system === lfm3SystemPrompt(files)) return;
  const messages = toChatMessages(system, history);
  const state = { cancelled: false, posted: false };
  _readAhead = state;
  void queue(
    () =>
      new Promise<void>((resolve) => {
        if (state.cancelled) {
          resolve();
          return;
        }
        const id = _nextId++;
        const settle = () => {
          if (_readAhead === state) _readAhead = null;
          resolve();
        };
        _pending.set(id, {
          onDone: settle,
          onError: (message) => {
            console.warn('[souffleurs] read-ahead failed:', message);
            settle();
          },
        });
        state.posted = true;
        getWorker().postMessage({
          type: 'chat',
          id,
          adapter: CALLER_ADAPTER,
          device,
          messages,
          tools,
          maxNewTokens: 1,
          ...adapterFiles,
        } satisfies MainToWorker);
      }),
  );
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

/**
 * Resolves an adapter's versioned files via the manifest (+ markSeen after ready), with the
 * whole gguf set: the engine loads the set's cached adapters once and picks one per request.
 */
async function resolveAdapterFiles(adapter: AdapterName) {
  const manifest = await getSouffleurManifest();
  const role = adapterRole(adapter);
  const setFiles = Object.fromEntries(
    manifest.roles().map((r) => [`souffleur-${r}`, manifest.ggufAdapterFile(r as SouffleurRole)]),
  ) as Partial<Record<AdapterName, string>>;
  return {
    files: {
      baseFile: manifest.ggufBaseFile(),
      adapterFile: manifest.ggufAdapterFile(role),
      setFiles,
    },
    size: manifest.ggufSize(role) ?? SIZE_ADAPTER_BYTES,
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
    // The engine's n_ctx — a hard limit now (wllama allocates it), declared
    // because <aparte-context> draws nothing without one and the compaction
    // selector budgets against it. The wire prompt is rebuilt every turn, but
    // llama.cpp reuses the KV cache of its unchanged prefix, so only the new
    // turn is prefilled.
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
    // LFM3 (ADR-003): the contract's core and files as the system message, the enabled tools in the contract's
    // words, the history as chat messages — the model's own template renders them in the engine.
    const messages = toChatMessages(lfm3SystemPrompt(files), request.messages);
    const tools = lfm3Tools(enabledTools);
    const maxNewTokens = Math.max(request.maxTokens ?? 0, CALLER_MAX_NEW_TOKENS);
    // An image among the files (6/11): the vision encoder joins the set's load at this turn — which re-reads its
    // prompt anyway, the list having changed — so the description reloads nothing and the closing turn keeps the
    // chat's cache (the M5: two reloads and a 57 s re-read per image turn). Only with WebGPU (no image reading
    // without it), and only once it is in the cache: a download belongs to the description, with its progress,
    // and a failed one to read_file — never to this turn.
    const imageEncoder =
      device === 'webgpu' && files.some((f) => f.type === 'image')
        ? (await getSouffleurManifest()).ggufMmprojFile()
        : null;
    const encoder =
      imageEncoder && (await getWorker().isCached([imageEncoder])) ? imageEncoder : undefined;
    // Diagnostics: on by default in dev (see setSouffleurDebug) — the messages, tools, raw output and calls in
    // the console. `localStorage.setItem('bp.debug','0')` silences, '1' forces in prod.
    const debug = isDebug();

    let raw = '';
    const prompt = JSON.stringify({ messages, tools: tools.map((t) => t.function.name) }, null, 1);
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
        setSouffleurStatus({
          status: _loadedAdapter === CALLER_ADAPTER ? 'generating' : 'loading',
          device,
        });

        void enqueue(
          () =>
            new Promise<void>((resolve) => {
              // Stopped while still queued (behind the warm-up, another turn, an
              // executor): the engine never sees it. Posting it anyway would
              // generate a reply nobody reads, and the abort sent at cancel time
              // could not reach a message the engine did not have yet.
              if (closed) {
                resolve();
                return;
              }
              const id = _nextId++;
              _pending.set(id, {
                onReady: () => {
                  resolved.markSeen();
                  // Loaded (or found loaded): the turn generates — not 'loading' until its end after an expert
                  // or a description ran.
                  if (!closed) setSouffleurStatus({ status: 'generating', device });
                },
                onChunk: (delta) => {
                  raw += delta;
                  emit({ type: 'text', delta });
                },
                // aparté has no event for a call still being written: the status carries it, and the chat page
                // shows its waiting dots until `done` brings the call (and its card).
                onToolStart: (tool) => {
                  if (!closed) setSouffleurStatus({ status: 'generating', device, tool });
                },
                onDone: (usage, calls = []) => {
                  const answered = !closed && calls.length === 0;
                  if (_lastWire)
                    _lastWire.raw = raw + (calls.length ? '\n' + JSON.stringify(calls) : '');
                  if (debug) {
                    console.log('[souffleurs] MESSAGES >>>\n%s', prompt);
                    console.log('[souffleurs] RAW OUTPUT >>>\n%s', raw);
                    console.log('[souffleurs] CALLS >>>', calls);
                  }
                  // Turn cancelled: do NOT trigger the tools the model had
                  // started announcing (emit() is already neutralized).
                  if (!closed) {
                    for (const call of calls) {
                      const input = parseCallArguments(call.arguments);
                      if (!input) {
                        console.warn(
                          '[souffleurs] tool call with unreadable arguments ignored:',
                          call,
                        );
                        continue;
                      }
                      emit({ type: 'tool_use', id: genCallId(), name: call.name, input });
                    }
                  }
                  emit({ type: 'done', usage });
                  setSouffleurStatus({ status: 'ready', device });
                  finish();
                  if (answered) readAhead(files, request.messages, tools, device, resolved.files);
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
                type: 'chat',
                id,
                adapter: CALLER_ADAPTER,
                device,
                messages,
                tools,
                maxNewTokens,
                debug,
                ...resolved.files,
                ...(encoder ? { mmprojFile: encoder } : {}),
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
      const manifest = await getSouffleurManifest();
      // Files of the manifest's CURRENT version: a bumped version shows up as
      // not-downloaded (the onboarding/modal re-downloads).
      return (await getWorker().isCached([
        manifest.ggufBaseFile(),
        manifest.ggufAdapterFile('chat'),
      ]))
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
      const base = souffleursBaseUrl();
      // the manifest's absolute files too: Liquid AI's base and mmproj are fetched from their repository
      const manifest = await getSouffleurManifest().catch(() => null);
      const elsewhere = new Set(
        [manifest?.hasGguf() ? manifest.ggufBaseFile() : null, manifest?.ggufMmprojFile()].filter(
          (f): f is string => !!f && /^https?:\/\//.test(f),
        ),
      );
      await new CacheManager().deleteMany((entry) => {
        const url = entry.metadata?.originalURL ?? '';
        return url.startsWith(base) || elsewhere.has(url);
      });
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

/* ── Vision: the base without adapter + the mmproj ────────────────────────── */

/**
 * read_file(image) — loads the base WITHOUT adapter plus the vision encoder
 * (mmproj) and asks it about the image.
 *
 * Goes through the SAME queue as the souffleurs: mechanically a souffleur swap.
 * The rendered text goes back as a tool result and souffleur-chat continues —
 * it stays text-only and never sees pixels (contract rule).
 *
 * Throws if the gguf block publishes no mmproj: the read_file handler turns
 * this into `ok:false` with the message, now shown to the user.
 */
export async function describeImage(blob: Blob, question: string): Promise<string> {
  const device = await detectComputeDevice();
  const manifest = await getSouffleurManifest();
  const mmprojFile = manifest.ggufMmprojFile();
  if (!mmprojFile) {
    throw new Error(
      "analyse d'image indisponible : l'encodeur vision n'est pas publié pour cette version du modèle",
    );
  }
  // Measured on the M5 without WebGPU: the encoder gave nothing in 25 minutes (and
  // wrong descriptions when only the encoder ran on the CPU). Waiting would end in
  // aparté's 5-minute tool abort, a silent turn and a queue blocked behind it.
  if (device === 'wasm') {
    throw new Error(
      "analyse d'image indisponible sur cet appareil : sans carte graphique (WebGPU), la lecture d'image ne fonctionne pas",
    );
  }
  const baseFile = manifest.ggufBaseFile();
  // The set: a load the description causes keeps the adapters, so the closing turn reloads nothing.
  const { setFiles } = (await resolveAdapterFiles(CALLER_ADAPTER)).files;
  const debug = isDebug();

  setSouffleurStatus({ status: 'loading', device });
  return enqueue(
    () =>
      new Promise<string>((resolve, reject) => {
        const id = _nextId++;
        const aggregator = new ProgressAggregator(manifest.ggufSize('mmproj') ?? SIZE_MMPROJ_BYTES);
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
            // Conservative: the description may have loaded the base without the set (a manifest without
            // one). With the set, the next turn finds its adapter at once and says so at its `ready`.
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
          baseFile,
          mmprojFile,
          setFiles,
          debug,
        } satisfies MainToWorker);
      }),
  );
}

/**
 * Prefills the caller's system message and tools into llama.cpp's prompt cache, so the
 * first message of a session does not pay for the whole tool block (44 s of the first turn on the M5, LFM3).
 * The template renders the system and the tools first, so a turn with the same tools starts with this
 * conversation's tokens; the one token generated is thrown away. Never rejects: a failed warm-up costs speed.
 */
export async function warmCaller(enabledToolNames: readonly string[]): Promise<void> {
  const device = await detectComputeDevice();
  const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
  const messages: ChatMessage[] = [{ role: 'system', content: lfm3SystemPrompt() }];
  const tools = lfm3Tools(enabledToolNames);
  return enqueue(
    () =>
      new Promise<void>((resolve) => {
        // Said out loud: on a CPU the prefill takes a minute and a half, and the
        // status carries the device the slow-device hint needs. Back to 'ready'
        // only if no chat turn has taken the status over in the meantime.
        const preparing: SouffleurStatusState = { status: 'loading', device };
        setSouffleurStatus(preparing);
        const settle = () => {
          if (getSouffleurStatus() === preparing) setSouffleurStatus({ status: 'ready', device });
          resolve();
        };
        const id = _nextId++;
        _pending.set(id, {
          onDone: settle,
          onError: (message) => {
            console.warn('[souffleurs] warm-up failed:', message);
            settle();
          },
        });
        getWorker().postMessage({
          type: 'chat',
          id,
          adapter: CALLER_ADAPTER,
          device,
          messages,
          tools,
          maxNewTokens: 1,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}

/**
 * Puts a gguf file (repo-relative, from the manifest) in the local cache WITHOUT
 * loading it: the executors and the mmproj are prefetched this way, so the warm
 * caller stays in memory. Not queued — a download does not touch the model.
 */
export function prefetchFile(
  file: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return getWorker().download(file, onProgress);
}

export function isFileCached(file: string): Promise<boolean> {
  return getWorker().isCached([file]);
}

/** Loads an executor adapter into memory (downloading it first if needed). */
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
 * Runs an executor souffleur — on LFM3 the json-render expert (`souffleur-render`, ADR-003).
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
  // `intent: ` prefix — the TRAINING FORMAT of every executor, the LFM2.5 ones (lab audit of 07/26,
  // HANDOFF-fixes-bonaparte §1) and the json-render expert (its dataset rows, chain_test.py). The app once sent
  // the bare task: every file generation was out of distribution.
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `intent: ${task}` },
  ];
  const prompt = JSON.stringify(messages, null, 1);
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
            resolve({ raw, usage });
          },
          onError: (message) => {
            settle();
            setSouffleurStatus({ status: 'error', message, device });
            reject(new Error(message));
          },
        });
        getWorker().postMessage({
          type: 'chat',
          id,
          adapter,
          device,
          messages,
          maxNewTokens: opts.maxNewTokens ?? EXECUTOR_MAX_NEW_TOKENS,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}
