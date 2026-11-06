/**
 * The wllama engine (ADR-014) — llama.cpp in WASM/WebGPU, behind the message protocol the
 * transformers.js worker spoke. It runs in the page: wllama already isolates the compute in
 * its own worker, and that is the setup measured on the M5.
 *
 * One model in memory: the GGUF base and the adapters of the souffleur set already in the
 * cache, loaded together, each request naming its own (`lora: [{ id, scale }]`). Switching
 * souffleur used to reload the model, and the chat then re-read its whole prompt after every
 * document: 43.5 s with the GPU, 130 s without, on the M5 (5/11). With one load, a slot per
 * souffleur and LFM3's sliding window kept whole, the chat resumes from its cache: 2.6 s and
 * 4.2 s (aparte-repetitions/lab/2026-10-lfm3-bench/m5-prompt-cache-2026-11-05.md).
 * Vision = the base without adapter + the mmproj, a load of its own. Every file is downloaded
 * through the cache and handed to `loadModel` as a Blob: wllama's own model cache keys on the
 * model URL alone and served a text-only model when the mmproj was added later — the image
 * was then ignored silently.
 */
import { CacheManager, Wllama } from '@wllama/wllama';
import type { AdapterName } from '../model-catalog';
import type { ChatMessage } from '../wire/chat-wire';
import type { Lfm3Tool } from '../wire/contract-lfm3';
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

/** Runtime context of a conversation (one slot). Training sequences are ≤ 4,096 tokens. */
export const N_CTX = 8192;

/**
 * Slots of N_CTX each, not one unified cache: the chat keeps its own and the expert takes the
 * other (llama.cpp picks the slot whose cache matches the prompt best). With `kv_unified`,
 * wllama's default, the idle chat slot was emptied while the expert ran (reproduced on a
 * native llama-server built from the same source). LFM3's KV cache for 2 × 8,192 tokens with
 * the sliding window whole: 352 MiB.
 */
export const N_SLOTS = 2;

/** Prompt tokens per llama.cpp batch: one ubatch (512), where wllama can abort. */
export const N_BATCH = 512;

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
  /** The loaded adapter this request runs with; the others stay at scale 0. */
  lora?: LoraScale[];
}

export interface LoraScale {
  id: number;
  scale: number;
}

export interface CompletionChunk {
  choices: { text: string; finish_reason?: string | null }[];
  timings?: LlamaTimings;
}

export interface ChatImagePart {
  type: 'image';
  data: ArrayBuffer;
}

/** A streamed chat chunk (OpenAI shape, llama-server's): text, and the calls arriving piece by piece. */
export interface ChatStreamChunk {
  choices: {
    delta?: {
      content?: string | null;
      tool_calls?: { index: number; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  timings?: LlamaTimings;
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
  /** A slot's prompt cache as llama-server's slot file (wllama 3.12.0-aparte-lfm3.2). The slot must be idle. */
  saveSlot(idSlot: number): Promise<{ nTokens: number; data: Uint8Array }>;
  /** Puts a saved slot back, with the adapters its cache was built with (a restored slot has none of its own). */
  restoreSlot(idSlot: number, file: Blob, lora?: LoraScale[]): Promise<{ nTokens: number }>;
}

/** Where the boot warm-up's slot is kept across app starts (ADR-018). */
export interface SlotStore {
  get(key: string): Promise<Blob | null>;
  /** Keeps `data` under `key` and drops the slot kept before for the same device. */
  put(key: string, device: ComputeDevice, data: Uint8Array): Promise<void>;
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
  /** The boot warm-up kept across app starts; without it, every start reads it again. */
  slots?: SlotStore;
}

interface Loaded {
  key: string;
  wllama: WllamaLike;
  /** The adapters loaded with the base, in their lora id order. */
  adapters: { name: AdapterName; file: string }[];
  /** The vision encoder loaded with them, if any: kept by the loads that follow on the same base. */
  mmproj: string | null;
  /** No request has run yet: the first one takes slot 0 (llama.cpp gives an empty slot, the lowest id first). */
  fresh: boolean;
}

/** The slot a fresh instance's first request takes — the boot warm-up's, saved and restored there. */
const WARM_SLOT = 0;

/**
 * Bumped with anything that changes the slot file or what fills it beyond the key's parts: the vendored wllama
 * (its llama.cpp), the context, the slots, the sliding window kept whole.
 */
const SLOT_FORMAT = 'wllama-3.12.0-aparte-lfm3.2';

/**
 * The saved warm-up's key: everything that shapes its cache. Only the request's adapter counts — the others of the
 * set run at scale 0, which llama.cpp leaves out of the graph — so downloading an expert keeps the saved slot.
 */
export async function slotKey(parts: {
  baseFile: string;
  adapterFile: string;
  device: ComputeDevice;
  messages: ChatMessage[];
  tools?: readonly Lfm3Tool[];
}): Promise<string> {
  const text = JSON.stringify([
    SLOT_FORMAT,
    N_CTX,
    N_SLOTS,
    parts.baseFile,
    parts.adapterFile,
    parts.device,
    parts.messages,
    parts.tools ?? [],
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${parts.device}-${hex.slice(0, 32)}`;
}

type Send = (msg: WorkerToMain) => void;

export class WllamaEngine implements EngineLike {
  onmessage: ((event: { data: WorkerToMain }) => void) | null = null;

  private loaded: Loaded | null = null;
  /** An encoder that failed to download or to load for a souffleur's turn: those turns no longer ask for it. */
  private encoderRefused: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private running: AbortController | null = null;
  /** The message being handled, and whether a Stop reached it before its tokens started. */
  private current: { type: MainToWorker['type']; aborted: boolean } | null = null;

  constructor(private readonly deps: EngineDeps) {}

  postMessage(msg: MainToWorker): void {
    // Stop must reach the generation running now, not wait behind it — and a Stop that
    // lands while that generation is still downloading or loading must not be lost.
    if (msg.type === 'abort') {
      this.running?.abort();
      if (this.current?.type === 'generate' || this.current?.type === 'chat')
        this.current.aborted = true;
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

  /**
   * Puts a file in the cache without loading anything: prefetching the executors and the
   * mmproj this way leaves the loaded caller — and its warm prompt cache — untouched.
   */
  async download(
    file: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    await this.deps.cache.download(this.url(file), {
      progressCallback: ({ loaded, total }) => onProgress?.(loaded, total),
    });
  }

  /** A manifest path under the souffleurs repo, or an absolute URL kept as it is (Liquid AI's base and mmproj). */
  private url(file: string): string {
    return /^https?:\/\//.test(file) ? file : `${this.deps.baseUrl}/${file}`;
  }

  private async handle(msg: Exclude<MainToWorker, { type: 'abort' }>): Promise<void> {
    this.current = { type: msg.type, aborted: false };
    try {
      switch (msg.type) {
        case 'prepare':
          await this.ensure(
            msg.id,
            msg.adapter,
            msg.device,
            msg.baseFile,
            msg.adapterFile,
            msg.mmprojFile ?? null,
            msg.setFiles,
          );
          break;
        case 'generate':
          await this.ensure(
            msg.id,
            msg.adapter,
            msg.device,
            msg.baseFile,
            msg.adapterFile,
            msg.mmprojFile ?? null,
            msg.setFiles,
          );
          await this.generate(msg.id, msg.adapter, msg.prompt, msg.maxNewTokens, msg.debug);
          break;
        case 'chat':
          await this.ensure(
            msg.id,
            msg.adapter,
            msg.device,
            msg.baseFile,
            msg.adapterFile,
            msg.mmprojFile ?? null,
            msg.setFiles,
          );
          {
            const kept = msg.persist ? await this.restoreKept(msg) : null;
            // Saved before the warm-up's `done`: the message behind it waits in the provider's queue, where a Stop
            // reaches it — not here, where it would land on the warm-up (6/11 review). A restored slot from which
            // llama.cpp could not resume (it read the whole prompt again) is replaced.
            const onRead = kept
              ? async (timings?: LlamaTimings) => {
                  const readAgain = !!timings && timings.prompt_n > timings.cache_n;
                  if (!kept.restored || readAgain) await this.keep(kept.key, msg.device);
                }
              : undefined;
            await this.chat(
              msg.id,
              msg.adapter,
              msg.messages,
              msg.tools,
              msg.maxNewTokens,
              msg.debug,
              onRead,
            );
          }
          break;
        case 'warm':
          await this.ensure(
            msg.id,
            msg.adapter,
            msg.device,
            msg.baseFile,
            msg.adapterFile,
            msg.mmprojFile ?? null,
            msg.setFiles,
          );
          await this.warm(msg.id, msg.adapter, msg.prefix);
          break;
        case 'describe-image':
          await this.ensure(
            msg.id,
            'vision',
            msg.device,
            msg.baseFile,
            null,
            msg.mmprojFile,
            msg.setFiles,
          );
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
    } finally {
      this.current = null;
    }
  }

  private async release(): Promise<void> {
    const current = this.loaded;
    this.loaded = null;
    await current?.wllama.exit();
  }

  /**
   * Loads the base with the adapters of the set already in the cache, plus the one asked for —
   * or, for vision, the base with the mmproj — unless the model in memory already has it. An
   * adapter of the set downloaded after the load joins at its first use, with one reload.
   */
  private async ensure(
    id: number,
    role: AdapterName | 'vision',
    device: ComputeDevice,
    baseFile: string,
    adapterFile: string | null,
    mmprojFile: string | null,
    setFiles?: Partial<Record<AdapterName, string>>,
  ): Promise<void> {
    // The vision encoder is not part of the key: a load that has it serves the turns that do not ask for it, and
    // keeps it (6/11: an image turn reloaded twice and its closing turn re-read everything, 57 s with the M5's GPU).
    const key = [baseFile, device].join('|');
    const loaded = this.loaded;
    if (
      loaded?.key === key &&
      (!mmprojFile ||
        loaded.mmproj === mmprojFile ||
        (role !== 'vision' && this.encoderRefused === mmprojFile)) &&
      (role === 'vision' || loaded.adapters.some((a) => a.name === role && a.file === adapterFile))
    ) {
      this.send({ type: 'ready', id, adapter: role, ms: 0 });
      return;
    }
    const t0 = performance.now();
    let encoder = mmprojFile ?? (loaded?.key === key ? loaded.mmproj : null);
    // A souffleur's turn only carries the encoder for the description to come: it never costs the turn itself.
    if (role !== 'vision' && encoder === this.encoderRefused) encoder = null;

    // A souffleur's turn: the set's cached adapters and its own. A description: the set's cached adapters, so the
    // turn after it reloads nothing.
    const adapters: { name: AdapterName; file: string }[] = [];
    for (const [name, file] of Object.entries(setFiles ?? {}) as [AdapterName, string][]) {
      if (name === role && adapterFile) adapters.push({ name, file: adapterFile });
      else if (await this.deps.cache.has(this.url(file))) adapters.push({ name, file });
    }
    if (role !== 'vision' && adapterFile && !adapters.some((a) => a.name === role))
      adapters.push({ name: role, file: adapterFile });

    // Every file first: a download that fails (offline, 404) must leave the model in
    // memory — and its warm prompt cache — where it was.
    const base = await this.fetch(id, baseFile);
    let mmproj: Blob | null = null;
    if (encoder) {
      try {
        mmproj = await this.fetch(id, encoder);
      } catch (err) {
        if (role === 'vision') throw err;
        this.encoderRefused = encoder;
        encoder = null;
      }
    }
    const blobs: Blob[] = [];
    for (const a of adapters) blobs.push(await this.fetch(id, a.file));

    await this.release();
    let wllama: WllamaLike;
    try {
      wllama = await this.load(device, base, mmproj, blobs);
    } catch (err) {
      // Out of memory with the encoder, say: a souffleur's turn is made again without it.
      if (!mmproj || role === 'vision') throw err;
      this.encoderRefused = encoder;
      encoder = null;
      wllama = await this.load(device, base, null, blobs);
    }
    this.loaded = { key, wllama, adapters, mmproj: encoder, fresh: true };
    this.send({ type: 'ready', id, adapter: role, ms: Math.round(performance.now() - t0) });
  }

  /**
   * The boot warm-up on an instance that has run nothing yet: the slot saved at an earlier start goes back into slot
   * 0, the one its request takes, with the adapter its cache was built with. Null when there is nothing to keep: no
   * store, or an instance whose slots already hold other prompts.
   */
  private async restoreKept(
    msg: Extract<MainToWorker, { type: 'chat' }>,
  ): Promise<{ key: string; restored: boolean } | null> {
    const loaded = this.loaded;
    const store = this.deps.slots;
    if (!store || !loaded?.fresh) return null;
    const key = await slotKey(msg);
    const file = await store.get(key).catch(() => null);
    if (!file) return { key, restored: false };
    try {
      await loaded.wllama.restoreSlot(WARM_SLOT, file, this.lora(msg.adapter).lora ?? []);
      return { key, restored: true };
    } catch (err) {
      // An older or damaged file: the warm-up reads its prompt again, and the new slot replaces it.
      console.warn('[souffleurs.engine] the saved warm-up did not restore; it is read again', err);
      return { key, restored: false };
    }
  }

  /** Saves the warm-up's slot for the next starts. Best-effort: a failure costs the next start its speed only. */
  private async keep(key: string, device: ComputeDevice): Promise<void> {
    const loaded = this.loaded;
    const store = this.deps.slots;
    if (!store || !loaded) return;
    try {
      const { data } = await loaded.wllama.saveSlot(WARM_SLOT);
      await store.put(key, device, data);
    } catch (err) {
      console.warn('[souffleurs.engine] the warm-up could not be saved for the next start', err);
    }
  }

  /** One wllama instance with the base, the encoder if any and the adapters; released again if the load fails. */
  private async load(
    device: ComputeDevice,
    base: Blob,
    mmproj: Blob | null,
    blobs: Blob[],
  ): Promise<WllamaLike> {
    const wllama = this.deps.createWllama();
    try {
      await wllama.loadModel(mmproj ? [base, mmproj] : [base], {
        n_gpu_layers: gpuLayers(device),
        // A prompt is read 512 tokens at a time (one ubatch): wllama sees an abort only between two batches, and
        // llama.cpp's default (2,048) let a Stop or a stopped read-ahead run ~30 s more with the M5's GPU.
        n_batch: N_BATCH,
        // the model's own chat template for `chat` (LFM3); the raw `generate` path never reads it
        jinja: true,
        ...(blobs.length
          ? {
              lora_adapters: blobs.map((blob) => ({ blob, scale: 1 })),
              // applied per request (`lora`), never all at once
              lora_init_without_apply: true,
              n_ctx: N_CTX * N_SLOTS,
              n_parallel: N_SLOTS,
              kv_unified: false,
              // LFM3's 256-token sliding window kept whole: without it llama.cpp cannot resume
              // from the checkpoint taken 4 tokens before a prompt's end and re-reads 516 tokens
              swa_full: true,
            }
          : { n_ctx: N_CTX }),
        ...(mmproj ? { image_max_tokens: IMAGE_MAX_TOKENS } : {}),
      });
    } catch (err) {
      // Its worker and WASM heap would otherwise stay alive, and retries pile them up.
      await wllama.exit().catch(() => undefined);
      throw err;
    }
    return wllama;
  }

  /** The request's adapter, by its id in the load; the others stay at scale 0. */
  private lora(role: AdapterName): { lora?: LoraScale[] } {
    const i = this.loaded?.adapters.findIndex((a) => a.name === role) ?? -1;
    return i < 0 ? {} : { lora: [{ id: i, scale: 1 }] };
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

  /** The model for a request: from now on its slots hold prompts the engine did not choose. */
  private model(): WllamaLike {
    if (!this.loaded) throw new Error('aucun modèle chargé');
    this.loaded.fresh = false;
    return this.loaded.wllama;
  }

  private async generate(
    id: number,
    adapter: AdapterName,
    prompt: string,
    maxNewTokens: number,
    debug?: boolean,
  ): Promise<void> {
    const t0 = performance.now();
    // Stopped while its model was downloading or loading: nothing to generate.
    if (this.current?.aborted) {
      this.send({ type: 'done', id, usage: usageFromTimings(undefined, 0, 0) });
      return;
    }
    const controller = new AbortController();
    this.running = controller;
    const guard = new RepetitionGuard();
    let tFirst = 0;
    let outputTokens = 0;
    let timings: LlamaTimings | undefined;
    let finish: string | null | undefined;
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
        ...this.lora(adapter),
      });
      for await (const chunk of stream) {
        if (chunk.timings) timings = chunk.timings;
        finish = chunk.choices[0]?.finish_reason ?? finish;
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
      if (!controller.signal.aborted) throw contextError(err) ?? err;
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
    // An executor's output is a whole program or document: cut by its token limit (or by
    // the context), it would be materialized broken. The caller's reply is short by
    // contract and simply ends at its cap.
    if (finish === 'length' && adapter !== 'souffleur-chat' && !controller.signal.aborted) {
      this.send({
        type: 'error',
        id,
        message: `sortie de ${adapter} tronquée à ${outputTokens} tokens (limite de génération ou de contexte atteinte)`,
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

  /**
   * LFM3: the messages and tools through the model's own template (llama.cpp's jinja, the lab bench's
   * `/v1/chat/completions`). Text streams as chunks; the calls are gathered by index as the template's parser
   * emits them and sent whole in `done`, never run half-written.
   */
  /** `onRead` runs before `done`, once the request ran to its end: its whole prompt is then in the cache. */
  private async chat(
    id: number,
    adapter: AdapterName,
    messages: ChatMessage[],
    tools: readonly Lfm3Tool[] | undefined,
    maxNewTokens: number,
    debug?: boolean,
    onRead?: (timings: LlamaTimings | undefined) => Promise<void>,
  ): Promise<void> {
    const t0 = performance.now();
    if (this.current?.aborted) {
      this.send({ type: 'done', id, usage: usageFromTimings(undefined, 0, 0) });
      return;
    }
    const controller = new AbortController();
    this.running = controller;
    const guard = new RepetitionGuard();
    const calls = new Map<number, { name: string; arguments: string }>();
    let tFirst = 0;
    let timings: LlamaTimings | undefined;
    let finish: string | null | undefined;
    let raw = '';
    try {
      const stream = (await this.model().createChatCompletion({
        messages,
        ...(tools?.length ? { tools } : {}),
        max_tokens: maxNewTokens,
        temperature: 0,
        stream: true,
        cache_prompt: true,
        chat_template_kwargs: { enable_thinking: false },
        abortSignal: controller.signal,
        ...this.lora(adapter),
      })) as unknown as AsyncIterable<ChatStreamChunk>;
      for await (const chunk of stream) {
        if (chunk.timings) timings = chunk.timings;
        const choice = chunk.choices[0];
        finish = choice?.finish_reason ?? finish;
        for (const part of choice?.delta?.tool_calls ?? []) {
          const call = calls.get(part.index) ?? { name: '', arguments: '' };
          const named = Boolean(call.name);
          call.name += part.function?.name ?? '';
          call.arguments += part.function?.arguments ?? '';
          calls.set(part.index, call);
          if (!named && call.name) this.send({ type: 'tool-start', id, name: call.name });
          if (!tFirst) tFirst = performance.now();
        }
        const text = choice?.delta?.content ?? '';
        if (!text) continue;
        if (!tFirst) tFirst = performance.now();
        raw += text;
        guard.push(text);
        if (guard.tripped) {
          controller.abort();
          break;
        }
        this.send({ type: 'chunk', id, delta: text });
      }
    } catch (err) {
      if (!controller.signal.aborted) throw contextError(err) ?? err;
    } finally {
      this.running = null;
    }
    const toolCalls = [...calls.values()].filter((c) => c.name);
    if (debug) console.log('[souffleurs.engine] CHAT >>>\n%s\nCALLS >>>', raw, toolCalls);

    if (guard.tripped) {
      this.send({
        type: 'error',
        id,
        message: `generation looped (${adapter} repeated the same line 4 times) — stopped`,
      });
      return;
    }
    if (finish === 'length' && adapter !== 'souffleur-chat' && !controller.signal.aborted) {
      this.send({
        type: 'error',
        id,
        message: `sortie de ${adapter} tronquée (limite de génération ou de contexte atteinte)`,
      });
      return;
    }
    if (onRead && !controller.signal.aborted) await onRead(timings);
    const now = performance.now();
    this.send({
      type: 'done',
      id,
      usage: usageFromTimings(timings, Math.round((tFirst || now) - t0), Math.round(now - t0)),
      ...(toolCalls.length ? { toolCalls } : {}),
    });
  }

  private async warm(id: number, adapter: AdapterName, prefix: string): Promise<void> {
    const t0 = performance.now();
    let timings: LlamaTimings | undefined;
    const stream = await this.model().createCompletion({
      prompt: toLlamaPrompt(prefix),
      max_tokens: 1,
      temperature: 0,
      cache_prompt: true,
      stream: true,
      preserved_tokens: TOOL_CALL_MARKERS,
      ...this.lora(adapter),
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
      // In the set's load, every adapter at 0: a request naming none runs them all at their load scale (llama.cpp's
      // default, 1 here) — measured natively, the description then differs from the base's.
      ...(this.loaded?.adapters.length ? { lora: [{ id: 0, scale: 0 }] } : {}),
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
      // A download cut mid-way is committed by OPFS without its metadata, and
      // getMetadata then polyfills `originalSize = size` with an empty URL: only a file
      // whose own metadata names this URL and its full size is complete.
      return size > 0 && meta?.originalURL === url && meta.originalSize === size;
    },
  };
}

/** The saved slots' pseudo-URLs in wllama's cache: never fetched, only names (`<device>-<hash>.bin`). */
const SLOT_ORIGIN = 'https://slots.aparte.invalid';

/**
 * The saved warm-up in OPFS, beside the weights, through wllama's CacheManager: one file per device (~32 MB for
 * the 0.4.0 contract), the one saved before for that device dropped.
 */
export function cacheManagerSlotStore(manager: CacheManager = new CacheManager()): SlotStore {
  const url = (key: string) => `${SLOT_ORIGIN}/${key}.bin`;
  return {
    async get(key) {
      const u = url(key);
      const name = await manager.getNameFromURL(u);
      const size = await manager.getSize(name);
      const meta = await manager.getMetadata(name);
      // A write cut mid-way leaves the file without its own metadata (see cacheManagerBlobCache).
      if (!(size > 0 && meta?.originalURL === u && meta.originalSize === size)) return null;
      // Read into memory now: an OPFS File is a snapshot another tab's save invalidates, and a read failing inside
      // wllama's restore leaves its worker unusable; failing here only costs the start its speed (6/11 review).
      const file = await manager.open(name);
      return file ? new Blob([await file.arrayBuffer()]) : null;
    },
    async put(key, device, data) {
      const u = url(key);
      const name = await manager.getNameFromURL(u);
      const blob = new Blob([data as Uint8Array<ArrayBuffer>]);
      await manager.write(name, blob.stream(), {
        etag: key,
        originalSize: blob.size,
        originalURL: u,
      });
      await manager.deleteMany(
        (e) =>
          e.name !== name &&
          (e.metadata?.originalURL ?? '').startsWith(`${SLOT_ORIGIN}/${device}-`),
      );
    },
  };
}

/**
 * llama.cpp refuses a prompt longer than the context with a technical message; the user
 * gets one that says what to do. Anything else is left as it is.
 */
function contextError(err: unknown): Error | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!/exceeds? the available context|context size|n_ctx/i.test(message)) return null;
  return new Error(
    `conversation trop longue pour le contexte du modèle (${N_CTX} tokens) — compactez-la ou commencez-en une nouvelle`,
  );
}

/**
 * A wllama instance whose code all comes from our own origin. Its constructor selects
 * the compat build for browsers without JSPI or Memory64 (Safari) and, left to that
 * default, fetches it from jsDelivr: overridden with the copies served under
 * /assets/ (scripts/copy-wllama-assets.mjs) — nothing leaves the device, and it works
 * offline.
 */
export function createWllama(): WllamaLike {
  const wllama = new Wllama({ default: '/assets/wllama/wllama.wasm' });
  wllama.setCompat({
    wasm: '/assets/wllama-compat/wllama.wasm',
    worker: '/assets/wllama-compat/wllama.js',
  });
  return wllama as unknown as WllamaLike;
}

/** The engine the app runs. */
export function createDefaultEngine(baseUrl: string): WllamaEngine {
  return new WllamaEngine({
    createWllama,
    cache: cacheManagerBlobCache(),
    baseUrl,
    slots: cacheManagerSlotStore(),
  });
}
