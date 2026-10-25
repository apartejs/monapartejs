import { describe, expect, it } from 'vitest';
import type { MainToWorker, WorkerToMain } from '../worker-protocol';
import type { LlamaTimings } from './llama-wire';
import {
  TOOL_CALL_MARKERS,
  WllamaEngine,
  type BlobCache,
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
  }

  async createCompletion(opts: CompletionOptions): Promise<AsyncIterable<CompletionChunk>> {
    this.completions.push(opts);
    const chunks = this.chunks();
    const gate = this.gate;
    return (async function* () {
      for (const [i, text] of chunks.entries()) {
        if (i === 1 && gate) await gate;
        if (opts.abortSignal?.aborted) throw new DOMException('aborted', 'AbortError');
        yield { choices: [{ text }] };
      }
      yield { choices: [{ text: '' }], timings: TIMINGS };
    })();
  }

  async createChatCompletion(opts: Record<string, unknown>) {
    this.chats.push(opts);
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
    expect(params['n_ctx']).toBe(8192);
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
