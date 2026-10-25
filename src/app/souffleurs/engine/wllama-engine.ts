/**
 * The wllama engine (ADR-014) — llama.cpp in WASM/WebGPU, behind the message protocol the
 * transformers.js worker spoke. It runs in the page: wllama already isolates the compute in
 * its own worker, and that is the setup measured on the M5.
 *
 * One model in memory. A souffleur = the GGUF base + its LoRA adapter, applied at load time,
 * so changing souffleur reloads (2.4 s measured) and drops the prompt cache. Vision = the
 * base without adapter + the mmproj. Every file is downloaded through the cache and handed
 * to `loadModel` as a Blob: wllama's own model cache keys on the model URL alone and served
 * a text-only model when the mmproj was added later — the image was then ignored silently.
 */
import { CacheManager, Wllama } from '@wllama/wllama';
import type { AdapterName } from '../model-catalog';
import { RepetitionGuard } from '../wire/repetition-guard';
import type {
  ComputeDevice,
  EngineLike,
  MainToWorker,
  WorkerFileProgress,
  WorkerToMain,
} from '../worker-protocol';
import { gpuLayers, toLlamaPrompt, usageFromTimings, type LlamaTimings } from './llama-wire';

/**
 * llama.cpp drops special tokens from the completion text unless the request preserves them:
 * without this the tool call arrives as a bare `[write_file(…)]` and the pythonic parser
 * never sees it (measured on the M5, wllama 3.8.1).
 */
export const TOOL_CALL_MARKERS = ['<|tool_call_start|>', '<|tool_call_end|>'];

/** Runtime context. Training sequences are ≤ 4,096 tokens; the KV cache at 8,192 is ≈ 100 MB. */
export const N_CTX = 8192;

/** One tile per image, as the ONNX path did by default: multi-tile took 43–98 s on the M5. */
export const IMAGE_MAX_TOKENS = 256;

export interface CompletionOptions {
  prompt: string;
  max_tokens: number;
  temperature: number;
  cache_prompt: boolean;
  stream: true;
  preserved_tokens: string[];
  abortSignal?: AbortSignal;
}

export interface CompletionChunk {
  choices: { text: string }[];
  timings?: LlamaTimings;
}

export interface ChatImagePart {
  type: 'image';
  data: ArrayBuffer;
}

/** The slice of Wllama this engine uses — a seam for tests. */
export interface WllamaLike {
  loadModel(blobs: Blob[], params: Record<string, unknown>): Promise<void>;
  createCompletion(opts: CompletionOptions): Promise<AsyncIterable<CompletionChunk>>;
  createChatCompletion(opts: Record<string, unknown>): Promise<{
    choices: { message: { content: string } }[];
    timings?: LlamaTimings;
  }>;
  exit(): Promise<void>;
}

export interface BlobCache {
  download(
    url: string,
    opts: { progressCallback?: (p: { loaded: number; total: number }) => void },
  ): Promise<void>;
  open(url: string): Promise<Blob | null>;
  has(url: string): Promise<boolean>;
}

export interface EngineDeps {
  createWllama(): WllamaLike;
  cache: BlobCache;
  /** e.g. `https://huggingface.co/apartejs/aparte-souffleurs/resolve/main` */
  baseUrl: string;
}

interface Loaded {
  key: string;
  wllama: WllamaLike;
}

type Send = (msg: WorkerToMain) => void;

export class WllamaEngine implements EngineLike {
  onmessage: ((event: { data: WorkerToMain }) => void) | null = null;

  private loaded: Loaded | null = null;
  private chain: Promise<void> = Promise.resolve();
  private running: AbortController | null = null;

  constructor(private readonly deps: EngineDeps) {}

  postMessage(msg: MainToWorker): void {
    // Stop must reach the generation running now, not wait behind it.
    if (msg.type === 'abort') {
      this.running?.abort();
      return;
    }
    this.chain = this.chain.then(() => this.handle(msg));
  }

  async isCached(files: readonly string[]): Promise<boolean> {
    for (const file of files) {
      if (!(await this.deps.cache.has(this.url(file)))) return false;
    }
    return true;
  }

  private send: Send = (msg) => this.onmessage?.({ data: msg });

  private url(file: string): string {
    return `${this.deps.baseUrl}/${file}`;
  }

  private async handle(msg: Exclude<MainToWorker, { type: 'abort' }>): Promise<void> {
    try {
      switch (msg.type) {
        case 'prepare':
          await this.ensure(msg.id, msg.adapter, msg.device, msg.baseFile, msg.adapterFile, null);
          break;
        case 'generate':
          await this.ensure(msg.id, msg.adapter, msg.device, msg.baseFile, msg.adapterFile, null);
          await this.generate(msg.id, msg.adapter, msg.prompt, msg.maxNewTokens, msg.debug);
          break;
        case 'warm':
          await this.ensure(msg.id, msg.adapter, msg.device, msg.baseFile, msg.adapterFile, null);
          await this.warm(msg.id, msg.prefix);
          break;
        case 'describe-image':
          await this.ensure(msg.id, 'vision', msg.device, msg.baseFile, null, msg.mmprojFile);
          await this.describe(msg.id, msg.blob, msg.question, msg.maxNewTokens, msg.debug);
          break;
        case 'dispose':
          await this.release();
          break;
      }
    } catch (err) {
      if ('id' in msg) {
        this.send({
          type: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async release(): Promise<void> {
    const current = this.loaded;
    this.loaded = null;
    await current?.wllama.exit();
  }

  /** Loads base (+ adapter | + mmproj) unless that exact set is already in memory. */
  private async ensure(
    id: number,
    role: AdapterName | 'vision',
    device: ComputeDevice,
    baseFile: string,
    adapterFile: string | null,
    mmprojFile: string | null,
  ): Promise<void> {
    const key = [baseFile, adapterFile ?? '', mmprojFile ?? '', device].join('|');
    if (this.loaded?.key === key) {
      this.send({ type: 'ready', id, adapter: role, ms: 0 });
      return;
    }
    const t0 = performance.now();
    await this.release();

    const base = await this.fetch(id, baseFile);
    const mmproj = mmprojFile ? await this.fetch(id, mmprojFile) : null;
    const adapter = adapterFile ? await this.fetch(id, adapterFile) : null;

    const wllama = this.deps.createWllama();
    await wllama.loadModel(mmproj ? [base, mmproj] : [base], {
      n_ctx: N_CTX,
      n_gpu_layers: gpuLayers(device),
      ...(adapter ? { lora_adapters: [{ blob: adapter, scale: 1 }] } : {}),
      ...(mmproj ? { image_max_tokens: IMAGE_MAX_TOKENS } : {}),
    });
    this.loaded = { key, wllama };
    this.send({ type: 'ready', id, adapter: role, ms: Math.round(performance.now() - t0) });
  }

  private async fetch(id: number, file: string): Promise<Blob> {
    const url = this.url(file);
    const progress = (p: Omit<WorkerFileProgress, 'file'>) =>
      this.send({ type: 'progress', id, file, ...p });
    await this.deps.cache.download(url, {
      progressCallback: ({ loaded, total }) => progress({ loaded, total, done: false }),
    });
    const blob = await this.deps.cache.open(url);
    if (!blob) throw new Error(`fichier absent du cache après téléchargement : ${file}`);
    progress({ loaded: blob.size, total: blob.size, done: true });
    return blob;
  }

  private model(): WllamaLike {
    if (!this.loaded) throw new Error('aucun modèle chargé');
    return this.loaded.wllama;
  }

  private async generate(
    id: number,
    adapter: AdapterName,
    prompt: string,
    maxNewTokens: number,
    debug?: boolean,
  ): Promise<void> {
    const controller = new AbortController();
    this.running = controller;
    const guard = new RepetitionGuard();
    const t0 = performance.now();
    let tFirst = 0;
    let outputTokens = 0;
    let timings: LlamaTimings | undefined;
    let raw = '';
    try {
      const stream = await this.model().createCompletion({
        prompt: toLlamaPrompt(prompt),
        max_tokens: maxNewTokens,
        temperature: 0,
        cache_prompt: true,
        stream: true,
        preserved_tokens: TOOL_CALL_MARKERS,
        abortSignal: controller.signal,
      });
      for await (const chunk of stream) {
        if (chunk.timings) timings = chunk.timings;
        const text = chunk.choices[0]?.text ?? '';
        if (!text) continue;
        if (!tFirst) tFirst = performance.now();
        outputTokens++;
        raw += text;
        guard.push(text);
        if (guard.tripped) {
          controller.abort();
          break;
        }
        this.send({ type: 'chunk', id, delta: text });
      }
    } catch (err) {
      // A Stop is not a failure: the turn ends with what was produced, like the old worker.
      if (!controller.signal.aborted) throw err;
    } finally {
      this.running = null;
    }
    if (debug) console.log('[souffleurs.engine] RAW >>>\n%s', raw);

    if (guard.tripped) {
      this.send({
        type: 'error',
        id,
        message: `generation looped (${adapter} repeated the same line 4 times) — stopped after ${outputTokens} tokens`,
      });
      return;
    }
    const now = performance.now();
    this.send({
      type: 'done',
      id,
      usage: usageFromTimings(timings, Math.round((tFirst || now) - t0), Math.round(now - t0)),
    });
  }

  private async warm(id: number, prefix: string): Promise<void> {
    const t0 = performance.now();
    let timings: LlamaTimings | undefined;
    const stream = await this.model().createCompletion({
      prompt: toLlamaPrompt(prefix),
      max_tokens: 1,
      temperature: 0,
      cache_prompt: true,
      stream: true,
      preserved_tokens: TOOL_CALL_MARKERS,
    });
    for await (const chunk of stream) if (chunk.timings) timings = chunk.timings;
    const ms = Math.round(performance.now() - t0);
    this.send({
      type: 'done',
      id,
      usage: { ...usageFromTimings(timings, ms, ms), outputTokens: 0 },
    });
  }

  private async describe(
    id: number,
    blob: Blob,
    question: string,
    maxNewTokens: number,
    debug?: boolean,
  ): Promise<void> {
    const t0 = performance.now();
    const image: ChatImagePart = { type: 'image', data: await blob.arrayBuffer() };
    const res = await this.model().createChatCompletion({
      messages: [{ role: 'user', content: [image, { type: 'text', text: question }] }],
      max_tokens: maxNewTokens,
      temperature: 0,
    });
    const text = (res.choices[0]?.message?.content ?? '').trim();
    if (debug) console.log('[souffleurs.engine] DESCRIBE >>>\n%s', text || '(empty)');
    const ms = Math.round(performance.now() - t0);
    this.send({ type: 'chunk', id, delta: text });
    this.send({ type: 'done', id, usage: usageFromTimings(res.timings, ms, ms) });
  }
}

/** wllama's CacheManager as the engine's blob cache (OPFS, keyed by URL). */
export function cacheManagerBlobCache(manager: CacheManager = new CacheManager()): BlobCache {
  return {
    download: (url, opts) => manager.download(url, opts),
    open: (url) => manager.open(url),
    async has(url) {
      const name = await manager.getNameFromURL(url);
      const size = await manager.getSize(name);
      const meta = await manager.getMetadata(name);
      // A download stopped mid-way leaves a shorter file: only a complete one counts.
      return size > 0 && (!meta?.originalSize || meta.originalSize === size);
    },
  };
}

/** The engine the app runs: wllama's wasm served from our own origin, never a CDN. */
export function createDefaultEngine(baseUrl: string): WllamaEngine {
  return new WllamaEngine({
    createWllama: () =>
      new Wllama({ default: '/assets/wllama/wllama.wasm' }) as unknown as WllamaLike,
    cache: cacheManagerBlobCache(),
    baseUrl,
  });
}
