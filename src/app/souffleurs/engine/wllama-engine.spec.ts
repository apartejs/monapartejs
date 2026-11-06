import { beforeEach, describe, expect, it } from 'vitest';
import type { CacheManager } from '@wllama/wllama';
import type { MainToWorker, WorkerToMain } from '../worker-protocol';
import type { LlamaTimings } from './llama-wire';
import {
  TOOL_CALL_MARKERS,
  WllamaEngine,
  cacheManagerBlobCache,
  type BlobCache,
  type ChatStreamChunk,
  type CompletionChunk,
  type CompletionOptions,
  type WllamaLike,
} from './wllama-engine';

const BASE_URL = 'https://hf.example/r';
const BASE = 'gguf/base.gguf';
const CHAT = 'gguf/souffleur-chat-0.3.0-lora-f16.gguf';
const PDF = 'gguf/souffleur-pdf-0.1.0-lora-q8_0.gguf';
const MMPROJ = 'gguf/mmproj-pad-Q4_0.gguf';
const TIMINGS: LlamaTimings = {
  cache_n: 0,
  prompt_n: 12,
  prompt_ms: 40,
  predicted_n: 2,
  predicted_ms: 30,
};

class FakeWllama implements WllamaLike {
  /** Knobs for the failure tests, reset before each test. */
  static loadError: Error | null = null;
  static completionError: Error | null = null;
  static finishReason: 'stop' | 'length' = 'stop';

  loads: { blobs: Blob[]; params: Record<string, unknown> }[] = [];
  completions: CompletionOptions[] = [];
  chats: Record<string, unknown>[] = [];
  exits = 0;

  constructor(
    private readonly chunks: () => string[],
    private readonly gate?: Promise<void>,
  ) {}

  async loadModel(blobs: Blob[], params: Record<string, unknown>): Promise<void> {
    this.loads.push({ blobs, params });
    if (FakeWllama.loadError) throw FakeWllama.loadError;
  }

  async createCompletion(opts: CompletionOptions): Promise<AsyncIterable<CompletionChunk>> {
    this.completions.push(opts);
    if (FakeWllama.completionError) throw FakeWllama.completionError;
    const chunks = this.chunks();
    const gate = this.gate;
    const finish = FakeWllama.finishReason;
    return (async function* () {
      for (const [i, text] of chunks.entries()) {
        if (i === 1 && gate) await gate;
        if (opts.abortSignal?.aborted) throw new DOMException('aborted', 'AbortError');
        yield { choices: [{ text }] };
      }
      yield { choices: [{ text: '', finish_reason: finish }], timings: TIMINGS };
    })();
  }

  /** The streamed chat (LFM3) a test plays; the non-streamed call is the image description. */
  static chatStream: ChatStreamChunk[] = [];

  async createChatCompletion(opts: Record<string, unknown>) {
    this.chats.push(opts);
    if (opts['stream']) {
      const chunks = FakeWllama.chatStream;
      return (async function* () {
        yield* chunks;
      })() as never;
    }
    return { choices: [{ message: { content: ' A logo on a dark card. ' } }], timings: TIMINGS };
  }

  async exit(): Promise<void> {
    this.exits++;
  }
}

class MemoryCache implements BlobCache {
  readonly blobs = new Map<string, Blob>();
  downloads: string[] = [];
  async download(
    url: string,
    opts: { progressCallback?: (p: { loaded: number; total: number }) => void },
  ) {
    this.downloads.push(url);
    if (!this.blobs.has(url)) this.blobs.set(url, new Blob([url]));
    opts.progressCallback?.({ loaded: 1, total: 1 });
  }
  async open(url: string): Promise<Blob | null> {
    return this.blobs.get(url) ?? null;
  }
  async has(url: string): Promise<boolean> {
    return this.blobs.has(url);
  }
}

function setup(chunks: () => string[] = () => ['Bonjour', ' !'], gate?: Promise<void>) {
  const instances: FakeWllama[] = [];
  const cache = new MemoryCache();
  const engine = new WllamaEngine({
    createWllama: () => {
      const w = new FakeWllama(chunks, gate);
      instances.push(w);
      return w;
    },
    cache,
    baseUrl: BASE_URL,
  });
  const messages: WorkerToMain[] = [];
  engine.onmessage = (e) => messages.push(e.data);
  const settled = async (id: number, ...types: WorkerToMain['type'][]) => {
    for (let i = 0; i < 200; i++) {
      const hit = messages.find((m) => 'id' in m && m.id === id && types.includes(m.type));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 0));
    }
    throw new Error(`no ${types.join('/')} for ${id}: ${JSON.stringify(messages)}`);
  };
  const send = (msg: MainToWorker) => engine.postMessage(msg);
  return { engine, instances, cache, messages, settled, send };
}

const prepare = (
  id: number,
  adapterFile = CHAT,
  device: 'webgpu' | 'wasm' = 'webgpu',
): MainToWorker => ({
  type: 'prepare',
  id,
  adapter: adapterFile === CHAT ? 'souffleur-chat' : 'souffleur-pdf',
  device,
  baseFile: BASE,
  adapterFile,
});

const generate = (id: number, prompt = '<|startoftext|><|im_start|>user\nX'): MainToWorker => ({
  type: 'generate',
  id,
  adapter: 'souffleur-chat',
  device: 'webgpu',
  prompt,
  maxNewTokens: 64,
  baseFile: BASE,
  adapterFile: CHAT,
});

describe('WllamaEngine', () => {
  it('prepare loads base and adapter once', async () => {
    const { instances, cache, settled, send } = setup();
    send(prepare(1));
    await settled(1, 'ready');
    send(prepare(2));
    const second = await settled(2, 'ready');

    expect(instances).toHaveLength(1);
    expect(instances[0].loads).toHaveLength(1);
    const { blobs, params } = instances[0].loads[0];
    expect(blobs).toEqual([cache.blobs.get(`${BASE_URL}/${BASE}`)]);
    expect(params['n_ctx']).toBe(2 * 8192); // a slot of 8,192 per souffleur
    expect((params['lora_adapters'] as { blob: Blob }[])[0].blob).toBe(
      cache.blobs.get(`${BASE_URL}/${CHAT}`),
    );
    expect(second).toMatchObject({ type: 'ready', ms: 0 });
  });

  it('a different adapter reloads', async () => {
    const { instances, cache, settled, send } = setup();
    send(prepare(1));
    await settled(1, 'ready');
    send(prepare(2, PDF));
    await settled(2, 'ready');

    expect(instances).toHaveLength(2);
    expect(instances[0].exits).toBe(1);
    const lora = instances[1].loads[0].params['lora_adapters'] as { blob: Blob }[];
    expect(lora[0].blob).toBe(cache.blobs.get(`${BASE_URL}/${PDF}`));
  });

  it('generate sends one BOS and forwards text verbatim', async () => {
    const call = '<|tool_call_start|>[write_file(kind="pdf")]<|tool_call_end|>';
    const { instances, messages, settled, send } = setup(() => ['Je ', call]);
    send(generate(1));
    const done = await settled(1, 'done');

    const opts = instances[0].completions[0];
    expect(opts.prompt).toBe('<|im_start|>user\nX');
    expect(opts).toMatchObject({
      cache_prompt: true,
      temperature: 0,
      stream: true,
      max_tokens: 64,
    });
    expect(opts.preserved_tokens).toEqual(TOOL_CALL_MARKERS);
    expect(
      messages.filter((m) => m.type === 'chunk').map((m) => (m as { delta: string }).delta),
    ).toEqual(['Je ', call]);
    expect(done).toMatchObject({ usage: { inputTokens: 12, outputTokens: 2 } });
  });

  it('a looping generation fails the turn', async () => {
    const line = 'La même ligne qui revient\n';
    const { instances, settled, send } = setup(() => Array(6).fill(line));
    send(generate(1));
    const err = await settled(1, 'error');

    expect((err as { message: string }).message).toMatch(/^generation looped \(souffleur-chat/);
    expect(instances[0].completions[0].abortSignal?.aborted).toBe(true);
  });

  it('generate after abort runs on the same model', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { instances, settled, send } = setup(() => ['un', 'deux', 'trois'], gate);
    send(generate(1));
    await new Promise((r) => setTimeout(r, 5));
    send({ type: 'abort' });
    release();
    await settled(1, 'done');
    send(generate(2));
    await settled(2, 'done');

    expect(instances).toHaveLength(1);
    expect(instances[0].loads).toHaveLength(1);
    expect(instances[0].completions).toHaveLength(2);
  });

  it('warm fills the cache without output', async () => {
    const { instances, messages, settled, send } = setup();
    send({
      type: 'warm',
      id: 1,
      adapter: 'souffleur-chat',
      device: 'webgpu',
      prefix: '<|startoftext|><|im_start|>system\nSYS',
      baseFile: BASE,
      adapterFile: CHAT,
    });
    await settled(1, 'done');

    const opts = instances[0].completions[0];
    expect(opts).toMatchObject({
      prompt: '<|im_start|>system\nSYS',
      max_tokens: 1,
      cache_prompt: true,
    });
    expect(messages.some((m) => m.type === 'chunk')).toBe(false);
  });

  it('describe-image loads the mmproj without adapter', async () => {
    const { instances, cache, messages, settled, send } = setup();
    const image = new Blob([new Uint8Array([1, 2, 3])]);
    send({
      type: 'describe-image',
      id: 1,
      device: 'webgpu',
      blob: image,
      question: 'Describe this image.',
      maxNewTokens: 320,
      baseFile: BASE,
      mmprojFile: MMPROJ,
    });
    await settled(1, 'done');

    const { blobs, params } = instances[0].loads[0];
    expect(blobs).toEqual([
      cache.blobs.get(`${BASE_URL}/${BASE}`),
      cache.blobs.get(`${BASE_URL}/${MMPROJ}`),
    ]);
    expect(params['lora_adapters']).toBeUndefined();
    expect(params['image_max_tokens']).toBe(256);
    const content = (instances[0].chats[0]['messages'] as { content: { type: string }[] }[])[0]
      .content;
    expect(content[0]).toEqual({ type: 'image', data: await image.arrayBuffer() });
    expect(content[1]).toEqual({ type: 'text', text: 'Describe this image.' });
    expect(messages.find((m) => m.type === 'chunk')).toMatchObject({
      delta: 'A logo on a dark card.',
    });

    send(prepare(2));
    await settled(2, 'ready');
    expect(instances).toHaveLength(2);
  });

  it('wasm device keeps the model on the CPU', async () => {
    const { instances, settled, send } = setup();
    send(prepare(1, CHAT, 'wasm'));
    await settled(1, 'ready');
    expect(instances[0].loads[0].params['n_gpu_layers']).toBe(0);
  });

  it('isCached answers from the blob cache, with repo-relative paths', async () => {
    const { engine, cache } = setup();
    expect(await engine.isCached([BASE, CHAT])).toBe(false);
    cache.blobs.set(`${BASE_URL}/${BASE}`, new Blob(['b']));
    cache.blobs.set(`${BASE_URL}/${CHAT}`, new Blob(['c']));
    expect(await engine.isCached([BASE, CHAT])).toBe(true);
  });
});

describe('WllamaEngine — the gguf set in one load (5/11, M5)', () => {
  // Measured on the M5: reloading at every souffleur switch made the chat re-read its whole prompt after each document
  // (43.5 s with the GPU, 130 s without); one load with both adapters, two slots not unified and swa_full: 2.6 s / 4.2 s.
  const RENDER = 'gguf/souffleur-render-0.9.0-lora-f16.gguf';
  const SET = { 'souffleur-chat': CHAT, 'souffleur-render': RENDER };
  const inSet = (msg: MainToWorker): MainToWorker => ({ ...msg, setFiles: SET }) as MainToWorker;
  const renderGenerate = (id: number): MainToWorker =>
    inSet({ ...generate(id), adapter: 'souffleur-render', adapterFile: RENDER } as MainToWorker);
  const cached = (cache: { blobs: Map<string, Blob> }, ...files: string[]) =>
    files.forEach((f) => cache.blobs.set(`${BASE_URL}/${f}`, new Blob([f])));
  const loraOf = (opts: object) => (opts as { lora?: unknown }).lora;

  it('loads every cached adapter of the set with the base, once, and picks one per request', async () => {
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT, RENDER);
    send(inSet(generate(1)));
    await settled(1, 'done');
    send(renderGenerate(2));
    await settled(2, 'done');
    send(inSet(generate(3)));
    await settled(3, 'done');

    expect(instances).toHaveLength(1);
    expect(instances[0].loads).toHaveLength(1);
    const { params } = instances[0].loads[0];
    expect((params['lora_adapters'] as { blob: Blob }[]).map((a) => a.blob)).toEqual([
      cache.blobs.get(`${BASE_URL}/${CHAT}`),
      cache.blobs.get(`${BASE_URL}/${RENDER}`),
    ]);
    expect(params['lora_init_without_apply']).toBe(true);
    expect(instances[0].completions.map(loraOf)).toEqual([
      [{ id: 0, scale: 1 }],
      [{ id: 1, scale: 1 }],
      [{ id: 0, scale: 1 }],
    ]);
  });

  it('keeps a slot per souffleur: two slots of N_CTX, not unified, the sliding window whole', async () => {
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT, RENDER);
    send(inSet(prepare(1)));
    await settled(1, 'ready');

    expect(instances[0].loads[0].params).toMatchObject({
      n_ctx: 2 * 8192,
      n_parallel: 2,
      kv_unified: false,
      swa_full: true,
    });
  });

  it('adds an adapter of the set that was not in the cache at its first use, with one reload', async () => {
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT);
    send(inSet(prepare(1)));
    await settled(1, 'ready');
    expect(instances[0].loads[0].params['lora_adapters']).toHaveLength(1);

    send(renderGenerate(2));
    await settled(2, 'done');
    send(inSet(generate(3)));
    await settled(3, 'done');

    expect(instances).toHaveLength(2);
    expect(instances[1].loads[0].params['lora_adapters']).toHaveLength(2);
    expect(instances[1].completions.map(loraOf)).toEqual([
      [{ id: 1, scale: 1 }],
      [{ id: 0, scale: 1 }],
    ]);
  });

  it('the chat chat-completion names its adapter too', async () => {
    FakeWllama.chatStream = [
      { choices: [{ delta: { content: 'Bonjour' }, finish_reason: 'stop' }] },
    ];
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT, RENDER);
    send(
      inSet({
        type: 'chat',
        id: 1,
        adapter: 'souffleur-chat',
        device: 'webgpu',
        messages: [{ role: 'user', content: 'Bonjour' }],
        maxNewTokens: 16,
        baseFile: BASE,
        adapterFile: CHAT,
      }),
    );
    await settled(1, 'done');

    expect(loraOf(instances[0].chats[0])).toEqual([{ id: 0, scale: 1 }]);
  });
});

describe('WllamaEngine — chat (LFM3)', () => {
  const chat = (id: number): MainToWorker => ({
    type: 'chat',
    id,
    adapter: 'souffleur-chat',
    device: 'webgpu',
    messages: [
      { role: 'system', content: 'S' },
      { role: 'user', content: 'Combien font 17 % de 2 340 € ?' },
    ],
    tools: [],
    maxNewTokens: 64,
    baseFile: BASE,
    adapterFile: CHAT,
  });

  it('streams the text and sends the calls whole, gathered by index, in done', async () => {
    FakeWllama.chatStream = [
      { choices: [{ delta: { content: 'Je calcule' } }] },
      { choices: [{ delta: { content: ' ça.' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { name: 'compute', arguments: '{"expr' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'ession":"2340*17/100"}' } }],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], timings: TIMINGS },
    ];
    const { send, settled, messages, instances } = setup();
    send(chat(1));
    const done = await settled(1, 'done');
    const text = messages
      .flatMap((m) => (m.type === 'chunk' && m.id === 1 ? [m.delta] : []))
      .join('');
    expect(text).toBe('Je calcule ça.');
    expect(done).toMatchObject({
      toolCalls: [{ name: 'compute', arguments: '{"expression":"2340*17/100"}' }],
    });
    expect(instances[0].chats[0]).toMatchObject({
      stream: true,
      temperature: 0,
      cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(instances[0].chats[0]).not.toHaveProperty('tools'); // none enabled: none sent
    expect(instances[0].loads[0].params).toMatchObject({ jinja: true });
  });

  it('announces a call once, as soon as its name arrives, before done', async () => {
    FakeWllama.chatStream = [
      { choices: [{ delta: { content: 'Je calcule ça.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'compute' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], timings: TIMINGS },
    ];
    const { send, settled, messages } = setup();
    send(chat(3));
    await settled(3, 'done');
    const order = messages.filter((m) => m.id === 3).map((m) => m.type);
    expect(messages.filter((m) => m.type === 'tool-start')).toEqual([
      { type: 'tool-start', id: 3, name: 'compute' },
    ]);
    expect(order.indexOf('tool-start')).toBeLessThan(order.indexOf('done'));
  });

  it('sends no toolCalls for a plain answer', async () => {
    FakeWllama.chatStream = [
      { choices: [{ delta: { content: 'Bonjour !' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], timings: TIMINGS },
    ];
    const { send, settled } = setup();
    send(chat(2));
    expect(await settled(2, 'done')).not.toHaveProperty('toolCalls');
  });
});

describe('WllamaEngine.download', () => {
  it('stores a file in the cache without loading any model', async () => {
    const { engine, instances, cache } = setup();
    const seen: number[] = [];
    await engine.download(PDF, (loaded) => seen.push(loaded));
    expect(cache.downloads).toEqual([`${BASE_URL}/${PDF}`]);
    expect(seen).toEqual([1]);
    expect(instances).toHaveLength(0);
  });

  it('fetches a file given as an absolute URL (the base from Liquid AI) as it is', async () => {
    const { engine, cache } = setup();
    const liquid =
      'https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF/resolve/3d29af2/LFM3-Omni-2B-Q4_K_M.gguf';
    await engine.download(liquid);
    expect(cache.downloads).toEqual([liquid]);
    cache.blobs.set(liquid, new Blob(['b']));
    expect(await engine.isCached([liquid])).toBe(true);
  });
});

describe('WllamaEngine — failures and Stop', () => {
  beforeEach(() => {
    FakeWllama.loadError = null;
    FakeWllama.completionError = null;
    FakeWllama.finishReason = 'stop';
  });

  it('a Stop during the load skips the generation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const instances: FakeWllama[] = [];
    const cache = new MemoryCache();
    const download = cache.download.bind(cache);
    cache.download = async (url, opts) => {
      await gate;
      return download(url, opts);
    };
    const engine = new WllamaEngine({
      createWllama: () => {
        const w = new FakeWllama(() => ['un', 'deux']);
        instances.push(w);
        return w;
      },
      cache,
      baseUrl: BASE_URL,
    });
    const messages: WorkerToMain[] = [];
    engine.onmessage = (e) => messages.push(e.data);
    engine.postMessage(generate(1));
    await new Promise((r) => setTimeout(r, 5));
    engine.postMessage({ type: 'abort' });
    release();
    for (let i = 0; i < 100 && !messages.some((m) => m.type === 'done'); i++) {
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(messages.find((m) => m.type === 'done')).toMatchObject({ id: 1 });
    expect(instances[0].completions).toHaveLength(0);
  });

  it('a prompt over the context fails with a clear message', async () => {
    FakeWllama.completionError = new Error(
      'the request exceeds the available context size (9104 tokens), try increasing it',
    );
    const { settled, send } = setup();
    send(generate(1));
    const err = await settled(1, 'error');
    expect((err as { message: string }).message).toMatch(/^conversation trop longue/);
  });

  it('an executor cut by its token limit is an error, not a file', async () => {
    FakeWllama.finishReason = 'length';
    const { settled, send } = setup();
    send({ ...generate(1), adapter: 'souffleur-pdf', adapterFile: PDF });
    const err = await settled(1, 'error');
    expect((err as { message: string }).message).toMatch(/tronquée/);
  });

  it('the caller reaching its own cap still ends normally', async () => {
    FakeWllama.finishReason = 'length';
    const { settled, send } = setup();
    send(generate(1));
    await settled(1, 'done');
  });

  it('a failed adapter download keeps the loaded model', async () => {
    const { instances, cache, messages, settled, send } = setup();
    send(prepare(1));
    await settled(1, 'ready');
    const download = cache.download.bind(cache);
    cache.download = async (url, opts) => {
      if (url.endsWith(PDF)) throw new Error('réseau coupé');
      return download(url, opts);
    };
    send(prepare(2, PDF));
    await settled(2, 'error');
    send(generate(3));
    await settled(3, 'done');

    expect(instances).toHaveLength(1);
    expect(instances[0].exits).toBe(0);
    expect(messages.find((m) => 'id' in m && m.id === 3 && m.type === 'ready')).toMatchObject({
      ms: 0,
    });
  });

  it('a failed load releases the new instance', async () => {
    FakeWllama.loadError = new Error('gguf invalide');
    const { instances, settled, send } = setup();
    send(prepare(1));
    await settled(1, 'error');
    expect(instances[0].exits).toBe(1);
  });
});

describe('cacheManagerBlobCache.has', () => {
  const manager = (meta: { originalURL: string; originalSize: number } | null, size: number) =>
    ({
      getNameFromURL: async () => 'name',
      getSize: async () => size,
      getMetadata: async () => meta,
    }) as unknown as CacheManager;

  it('a file whose download was cut (no metadata of its own) is not complete', async () => {
    const cache = cacheManagerBlobCache(manager({ originalURL: '', originalSize: 100 }, 100));
    expect(await cache.has('https://hf/x.gguf')).toBe(false);
  });

  it('a file with its own URL and full size is complete', async () => {
    const cache = cacheManagerBlobCache(
      manager({ originalURL: 'https://hf/x.gguf', originalSize: 100 }, 100),
    );
    expect(await cache.has('https://hf/x.gguf')).toBe(true);
  });
});

describe('WllamaEngine — the vision encoder in the set’s load (6/11)', () => {
  // Measured on a native llama-server (wllama-lfm3's source): with the mmproj in the same load as the adapters, the
  // closing turn after a description read 230 tokens and found 1,828 in the cache; the app reloaded twice per image
  // turn and its closing turn re-read everything (57 s with the M5's GPU).
  const RENDER = 'gguf/souffleur-render-0.9.0-lora-f16.gguf';
  const SET = { 'souffleur-chat': CHAT, 'souffleur-render': RENDER };
  const cached = (cache: { blobs: Map<string, Blob> }, ...files: string[]) =>
    files.forEach((f) => cache.blobs.set(`${BASE_URL}/${f}`, new Blob([f])));
  const chat = (id: number, mmprojFile?: string): MainToWorker => ({
    type: 'chat',
    id,
    adapter: 'souffleur-chat',
    device: 'webgpu',
    messages: [{ role: 'user', content: 'Que vois-tu sur cette image ?' }],
    maxNewTokens: 16,
    baseFile: BASE,
    adapterFile: CHAT,
    setFiles: SET,
    ...(mmprojFile ? { mmprojFile } : {}),
  });
  const describeImage = (id: number): MainToWorker => ({
    type: 'describe-image',
    id,
    device: 'webgpu',
    blob: new Blob([new Uint8Array([1])]),
    question: 'Describe this image.',
    maxNewTokens: 64,
    baseFile: BASE,
    mmprojFile: MMPROJ,
    setFiles: SET,
  });
  const loraOf = (opts: object) => (opts as { lora?: unknown }).lora;

  beforeEach(() => {
    FakeWllama.loadError = null;
    FakeWllama.completionError = null;
    FakeWllama.finishReason = 'stop';
    FakeWllama.chatStream = [
      { choices: [{ delta: { content: 'Je lis.' }, finish_reason: 'stop' }] },
    ];
  });

  it('a turn that may read an image loads the encoder with the set; the description then reloads nothing', async () => {
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT, RENDER, MMPROJ);
    send(chat(1, MMPROJ));
    await settled(1, 'done');
    send(describeImage(2));
    await settled(2, 'done');
    send(chat(3));
    await settled(3, 'done');

    expect(instances).toHaveLength(1);
    const { blobs, params } = instances[0].loads[0];
    expect(blobs).toEqual([
      cache.blobs.get(`${BASE_URL}/${BASE}`),
      cache.blobs.get(`${BASE_URL}/${MMPROJ}`),
    ]);
    expect(params['lora_adapters']).toHaveLength(2);
    expect(params).toMatchObject({ image_max_tokens: 256, n_parallel: 2, swa_full: true });
  });

  it('describes with every adapter at 0: a request naming none would run them all at their load scale', async () => {
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT, RENDER, MMPROJ);
    send(chat(1, MMPROJ));
    await settled(1, 'done');
    send(describeImage(2));
    await settled(2, 'done');

    const description = instances[0].chats.find((c) => !c['stream'])!;
    expect(loraOf(description)).toEqual([{ id: 0, scale: 0 }]);
  });

  it('a description on a model without the encoder loads it with the set, so the next turn reloads nothing', async () => {
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT, RENDER, MMPROJ);
    send(chat(1));
    await settled(1, 'done');
    expect(instances[0].loads[0].blobs).toHaveLength(1);

    send(describeImage(2));
    await settled(2, 'done');
    send(chat(3));
    await settled(3, 'done');

    expect(instances).toHaveLength(2);
    expect(instances[1].loads[0].blobs).toHaveLength(2);
    expect(instances[1].loads[0].params['lora_adapters']).toHaveLength(2);
    expect(instances[1].chats.filter((c) => c['stream'])).toHaveLength(1);
  });
});

describe('WllamaEngine — the encoder never costs a turn, and a read-ahead stops within a batch (6/11 review)', () => {
  const RENDER = 'gguf/souffleur-render-0.9.0-lora-f16.gguf';
  const SET = { 'souffleur-chat': CHAT, 'souffleur-render': RENDER };
  const cached = (cache: { blobs: Map<string, Blob> }, ...files: string[]) =>
    files.forEach((f) => cache.blobs.set(`${BASE_URL}/${f}`, new Blob([f])));
  const chat = (id: number, mmprojFile?: string): MainToWorker => ({
    type: 'chat',
    id,
    adapter: 'souffleur-chat',
    device: 'webgpu',
    messages: [{ role: 'user', content: 'Merci !' }],
    maxNewTokens: 16,
    baseFile: BASE,
    adapterFile: CHAT,
    setFiles: SET,
    ...(mmprojFile ? { mmprojFile } : {}),
  });

  beforeEach(() => {
    FakeWllama.loadError = null;
    FakeWllama.completionError = null;
    FakeWllama.finishReason = 'stop';
    FakeWllama.chatStream = [
      { choices: [{ delta: { content: 'Avec plaisir.' }, finish_reason: 'stop' }] },
    ];
  });

  it('reads a prompt 512 tokens at a time: wllama sees an abort only between two batches', async () => {
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT, RENDER);
    send(chat(1));
    await settled(1, 'done');
    expect(instances[0].loads[0].params['n_batch']).toBe(512);
  });

  it('a turn whose encoder cannot be downloaded loads the set without it, and answers', async () => {
    const { instances, cache, settled, send } = setup();
    cached(cache, BASE, CHAT, RENDER);
    const download = cache.download.bind(cache);
    cache.download = async (url, opts) => {
      if (url.endsWith(MMPROJ)) throw new Error('réseau coupé');
      return download(url, opts);
    };
    send(chat(1, MMPROJ));
    await settled(1, 'done');
    expect(instances).toHaveLength(1);
    expect(instances[0].loads[0].blobs).toHaveLength(1);
  });

  it('a load that fails with the encoder is made again without it, and the next turns do not retry it', async () => {
    const original = FakeWllama.prototype.loadModel;
    FakeWllama.prototype.loadModel = async function (blobs, params) {
      this.loads.push({ blobs, params });
      if (blobs.length === 2) throw new Error('out of memory');
    };
    try {
      const { instances, cache, settled, send } = setup();
      cached(cache, BASE, CHAT, RENDER, MMPROJ);
      send(chat(1, MMPROJ));
      await settled(1, 'done');
      send(chat(2, MMPROJ));
      await settled(2, 'done');

      expect(instances).toHaveLength(2);
      expect(instances[0].exits).toBe(1);
      expect(instances[1].loads[0].blobs).toHaveLength(1);
    } finally {
      FakeWllama.prototype.loadModel = original;
    }
  });
});
