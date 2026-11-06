/**
 * Cancellation during generation: the worker replies `done` AFTER the stream
 * closes (`stopping.interrupt()` is only seen on the next token).
 * Regression covered here: this late enqueue threw inside `onmessage`, so
 * `resolve()` was never reached and the `_chain` queue stayed stuck
 * forever — no MORE generation after a cancel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AparteChatRequest } from '@aparte/core';

const MANIFEST = {
  schema: 'aparte-souffleurs/1',
  base: { rev: '2026-07-24', graph: 'onnx/model_q4.onnx', weights: 'onnx/model_q4.onnx_data' },
  souffleurs: {
    chat: { version: '0.3.0', file: 'adapters/souffleur-chat-0.3.0.data' },
    pdf: { version: '0.1.0', file: 'adapters/souffleur-pdf-0.1.0.data' },
    'xlsx-docx': { version: '0.1.0', file: 'adapters/souffleur-xlsx-docx-0.1.0.data' },
    sandbox: { version: '0.1.0', file: 'adapters/souffleur-sandbox-0.1.0.data' },
  },
  lfm3: {
    rev: '2026-10-25',
    base: { file: 'gguf/lfm25-vl-1.6b-Q4_K_M.gguf', size: 730896256 },
    mmproj: { version: '0.1.0', file: 'gguf/mmproj-lfm25-vl-1.6b-pad-Q4_0.gguf', size: 244046400 },
    souffleurs: {
      chat: { version: '0.3.0', file: 'gguf/souffleur-chat-0.3.0-lora-f16.gguf' },
      pdf: { version: '0.1.0', file: 'gguf/souffleur-pdf-0.1.0-lora-q8_0.gguf' },
      'xlsx-docx': { version: '0.1.0', file: 'gguf/souffleur-xlsx-docx-0.1.0-lora-q8_0.gguf' },
      sandbox: { version: '0.1.0', file: 'gguf/souffleur-sandbox-0.1.0-lora-q8_0.gguf' },
    },
  },
};

interface Posted {
  type: string;
  id?: number;
}

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly posted: Posted[] = [];

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(msg: Posted): void {
    this.posted.push(msg);
  }

  /** Reply from the worker to the main thread. */
  reply(data: unknown): void {
    this.onmessage?.({ data });
  }

  async isCached(): Promise<boolean> {
    return false;
  }

  async download(): Promise<void> {}

  sentIds(type: string): number[] {
    return this.posted.filter((m) => m.type === type).map((m) => m.id as number);
  }
}

const REQUEST = {
  messages: [{ role: 'user', content: 'bonjour' }],
} as unknown as AparteChatRequest;

/** The provider module with a fake engine behind getWorker(). */
async function load() {
  const mod = await import('./souffleurs-provider');
  mod.__setEngineForTests(new FakeWorker());
  return mod;
}

/** Lets the queue's microtasks run (`_chain.then(op)`). */
const tick = () => new Promise((r) => setTimeout(r, 0));

let lsStore = new Map<string, string>();

beforeEach(() => {
  const store = new Map<string, string>();
  lsStore = store;
  vi.resetModules();
  FakeWorker.last = null;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => MANIFEST })),
  );
  vi.stubGlobal('navigator', { gpu: undefined, language: 'fr' });
});

afterEach(() => vi.unstubAllGlobals());

describe('SouffleursProvider.chat — cancellation', () => {
  it('the late `done` after cancel does not throw and releases the queue', async () => {
    const { SouffleursProvider } = await load();

    const stream = (await SouffleursProvider.chat(REQUEST)) as ReadableStream;
    const reader = stream.getReader();
    await tick();

    const worker = FakeWorker.last;
    expect(worker).not.toBeNull();
    const [firstId] = worker!.sentIds('chat');
    expect(firstId).toBeTypeOf('number');

    await reader.cancel();
    expect(worker!.posted.some((m) => m.type === 'abort')).toBe(true);

    // The worker had already produced text + a complete turn: it arrives
    // AFTER the closure. No exception should escape onmessage.
    expect(() => {
      worker!.reply({ type: 'chunk', id: firstId, delta: 'du texte' });
      worker!.reply({
        type: 'done',
        id: firstId,
        usage: { inputTokens: 10, outputTokens: 2, ttftMs: 1, durationMs: 2 },
      });
    }).not.toThrow();

    // The queue isn't stuck: the next generation does go through.
    const second = (await SouffleursProvider.chat(REQUEST)) as ReadableStream;
    void second.getReader();
    await tick();
    expect(worker!.sentIds('chat').length).toBe(2);
  });

  it('without cancellation, the stream emits text then done', async () => {
    const { SouffleursProvider } = await load();

    const stream = (await SouffleursProvider.chat(REQUEST)) as ReadableStream;
    const reader = stream.getReader();
    await tick();

    const worker = FakeWorker.last!;
    const [id] = worker.sentIds('chat');
    worker.reply({ type: 'chunk', id, delta: 'salut' });
    worker.reply({
      type: 'done',
      id,
      usage: { inputTokens: 10, outputTokens: 1, ttftMs: 1, durationMs: 2 },
    });

    const events: { type: string }[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      events.push(value as { type: string });
    }
    expect(events.map((e) => e.type)).toEqual(['text', 'done']);
  });
});

/**
 * The executors were trained on a user turn `intent: <task>`
 * (100% of examples, lab audit of 07/26). The bare task was out of distribution.
 */
describe('runExecutor — user turn format', () => {
  it('prefixes the task with `intent: ` as at training time', async () => {
    const { runExecutor } = await load();
    const pending = runExecutor('souffleur-sandbox', 'SYSTEM', 'somme de 1 à 10');
    await tick();
    await tick();
    const worker = FakeWorker.last!;
    const chat = worker.posted.find((m) => m.type === 'chat') as
      (Posted & { messages: { role: string; content: string }[]; tools?: unknown }) | undefined;
    expect(chat).toBeDefined();
    expect(chat!.messages).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'intent: somme de 1 à 10' },
    ]);
    expect(chat!.tools).toBeUndefined(); // an executor writes, it calls nothing
    worker.reply({ type: 'chunk', id: chat!.id, delta: '```yaml-spec\nroot: doc\n```' });
    worker.reply({
      type: 'done',
      id: chat!.id,
      usage: { inputTokens: 5, outputTokens: 1, ttftMs: 1, durationMs: 2 },
    });
    await expect(pending).resolves.toMatchObject({ raw: '```yaml-spec\nroot: doc\n```' });
  });
});

/**
 * The conversation's Stop aborts the tool handler's signal; the executor must
 * stop the worker and reject as an AbortError (what the engine expects).
 */
describe('runExecutor — abort', () => {
  it('posts `abort` to the worker and rejects with AbortError', async () => {
    const { runExecutor } = await load();
    const controller = new AbortController();
    const pending = runExecutor('souffleur-pdf', 'SYSTEM', 'facture', {
      signal: controller.signal,
    });
    await tick();
    await tick();
    const worker = FakeWorker.last!;
    expect(worker.sentIds('chat').length).toBe(1);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.posted.some((m) => m.type === 'abort')).toBe(true);

    // The worker still answers `done` after the interrupt: must not throw.
    const [id] = worker.sentIds('chat');
    expect(() =>
      worker.reply({
        type: 'done',
        id,
        usage: { inputTokens: 1, outputTokens: 1, ttftMs: 1, durationMs: 1 },
      }),
    ).not.toThrow();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { runExecutor } = await load();
    const controller = new AbortController();
    controller.abort();
    await expect(
      runExecutor('souffleur-pdf', 'SYSTEM', 'facture', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.last?.sentIds('chat') ?? []).toEqual([]);
  });
});

/**
 * In dev we want the wire traces WITHOUT having to enable anything —
 * explicit request. `bp.debug` remains an override in both directions.
 */
describe('provider verbosity', () => {
  const wireLogged = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.some((c) => String(c[0]).includes('MESSAGES'));

  async function runTurn(configure: (m: typeof import('./souffleurs-provider')) => void) {
    const mod = await load();
    configure(mod);
    const log = vi.fn();
    vi.stubGlobal('console', { ...console, log, warn: vi.fn() });
    const stream = (await mod.SouffleursProvider.chat(REQUEST)) as ReadableStream;
    void stream.getReader();
    await tick();
    const worker = FakeWorker.last!;
    const [id] = worker.sentIds('chat');
    worker.reply({ type: 'chunk', id, delta: 'bonjour' });
    worker.reply({
      type: 'done',
      id,
      usage: { inputTokens: 5, outputTokens: 1, ttftMs: 1, durationMs: 2 },
    });
    await tick();
    return log;
  }

  it('dev mode: traces active without a flag', async () => {
    const log = await runTurn((m) => m.setSouffleurDebug(true));
    expect(wireLogged(log)).toBe(true);
  });

  it('prod mode: silent without a flag', async () => {
    const log = await runTurn((m) => m.setSouffleurDebug(false));
    expect(wireLogged(log)).toBe(false);
  });

  it("bp.debug='0' silences even in dev", async () => {
    lsStore.set('bp.debug', '0');
    const log = await runTurn((m) => m.setSouffleurDebug(true));
    expect(wireLogged(log)).toBe(false);
  });

  it("bp.debug='1' forces even in prod", async () => {
    lsStore.set('bp.debug', '1');
    const log = await runTurn((m) => m.setSouffleurDebug(false));
    expect(wireLogged(log)).toBe(true);
  });
});

describe('provider on the wllama engine', () => {
  it('files come from the gguf block', async () => {
    const { SouffleursProvider } = await load();
    void SouffleursProvider.prepareModel?.('souffleur-chat', () => undefined);
    await tick();
    await tick();
    const prepare = FakeWorker.last!.posted.find((m) => m.type === 'prepare') as
      (Posted & { baseFile: string; adapterFile: string }) | undefined;
    expect(prepare).toMatchObject({
      baseFile: 'gguf/lfm25-vl-1.6b-Q4_K_M.gguf',
      adapterFile: 'gguf/souffleur-chat-0.3.0-lora-f16.gguf',
    });
  });

  it('every message carries the whole gguf set, so the engine loads it once', async () => {
    const { SouffleursProvider } = await load();
    void SouffleursProvider.prepareModel?.('souffleur-chat', () => undefined);
    await tick();
    await tick();
    const prepare = FakeWorker.last!.posted.find((m) => m.type === 'prepare') as
      (Posted & { setFiles?: Record<string, string> }) | undefined;
    expect(prepare?.setFiles).toEqual({
      'souffleur-chat': 'gguf/souffleur-chat-0.3.0-lora-f16.gguf',
      'souffleur-pdf': 'gguf/souffleur-pdf-0.1.0-lora-q8_0.gguf',
      'souffleur-xlsx-docx': 'gguf/souffleur-xlsx-docx-0.1.0-lora-q8_0.gguf',
      'souffleur-sandbox': 'gguf/souffleur-sandbox-0.1.0-lora-q8_0.gguf',
    });
  });

  it('warmCaller warms the system and tools the next chat turn starts with', async () => {
    const { SouffleursProvider, warmCaller } = await load();
    const warmed = warmCaller(['read_file', 'render']);
    await tick();
    await tick();
    const worker = FakeWorker.last!;
    type ChatPost = Posted & { messages: unknown[]; tools: unknown[]; maxNewTokens: number };
    const warm = worker.posted.find((m) => m.type === 'chat') as ChatPost | undefined;
    expect(warm).toMatchObject({ maxNewTokens: 1 });
    worker.reply({
      type: 'done',
      id: warm!.id,
      usage: { inputTokens: 1, outputTokens: 0, ttftMs: 1, durationMs: 1 },
    });
    await warmed;

    const request = {
      ...REQUEST,
      tools: [{ name: 'read_file' }, { name: 'render' }],
    } as unknown as AparteChatRequest;
    void ((await SouffleursProvider.chat(request)) as ReadableStream).getReader();
    await tick();
    const turn = worker.posted.filter((m) => m.type === 'chat')[1] as ChatPost;
    expect(turn.messages[0]).toEqual(warm!.messages[0]);
    expect(turn.tools).toEqual(warm!.tools);
    expect(warm!.messages).toHaveLength(1);
  });

  it('the warm-up reports that it is preparing the model, on its device, then that it is ready', async () => {
    const { warmCaller } = await load();
    const { subscribeSouffleurStatus } = await import('./status');
    const seen: { status: string; device?: string }[] = [];
    const off = subscribeSouffleurStatus((s) => seen.push({ status: s.status, device: s.device }));
    const warmed = warmCaller(['read_file']);
    await tick();
    await tick();
    const worker = FakeWorker.last!;
    const warm = worker.posted.find((m) => m.type === 'chat') as
      (Posted & { device: string }) | undefined;
    worker.reply({
      type: 'done',
      id: warm!.id,
      usage: { inputTokens: 1, outputTokens: 0, ttftMs: 1, durationMs: 1 },
    });
    await warmed;
    off();

    // seen[0] is the state at subscription time.
    expect(seen.slice(1)).toEqual([
      { status: 'loading', device: warm!.device },
      { status: 'ready', device: warm!.device },
    ]);
  });

  it('a chat turn started during the warm-up keeps its status when the warm-up ends', async () => {
    const { SouffleursProvider, warmCaller } = await load();
    const { getSouffleurStatus } = await import('./status');
    const warmed = warmCaller(['read_file']);
    await tick();
    await tick();
    const worker = FakeWorker.last!;
    const warm = worker.posted.find((m) => m.type === 'chat');
    void ((await SouffleursProvider.chat(REQUEST)) as ReadableStream).getReader();
    const duringChat = getSouffleurStatus();

    worker.reply({
      type: 'done',
      id: warm!.id,
      usage: { inputTokens: 1, outputTokens: 0, ttftMs: 1, durationMs: 1 },
    });
    await warmed;

    expect(getSouffleurStatus()).toBe(duringChat);
  });

  it('a manifest without mmproj makes image reading fail clearly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...MANIFEST, lfm3: { ...MANIFEST.lfm3, mmproj: undefined } }),
      })),
    );
    const { describeImage } = await load();
    await expect(describeImage(new Blob(['x']), 'Describe.')).rejects.toThrow(
      /^analyse d'image indisponible/,
    );
  });

  it('without WebGPU, image reading fails at once and says why — the engine is never asked', async () => {
    // Measured on the M5's CPU: the vision encoder gave nothing in 25 minutes, and
    // aparté aborted the tool after 5 with a silent turn and a blocked queue.
    const { describeImage } = await load();
    await expect(describeImage(new Blob(['x']), 'Describe.')).rejects.toThrow(
      /^analyse d'image indisponible sur cet appareil/,
    );
    expect(FakeWorker.last?.posted.some((m) => m.type === 'describe-image') ?? false).toBe(false);
  });

  it('with WebGPU, an image goes to the engine with the mmproj', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) }, language: 'fr' });
    const { describeImage } = await load();
    const described = describeImage(new Blob(['x']), 'Describe.');
    await tick();
    await tick();
    const worker = FakeWorker.last!;
    const request = worker.posted.find((m) => m.type === 'describe-image') as
      (Posted & { mmprojFile: string }) | undefined;
    expect(request?.mmprojFile).toBe(MANIFEST.lfm3.mmproj.file);
    worker.reply({ type: 'chunk', id: request!.id, delta: 'A logo.' });
    worker.reply({
      type: 'done',
      id: request!.id,
      usage: { inputTokens: 1, outputTokens: 2, ttftMs: 1, durationMs: 1 },
    });
    await expect(described).resolves.toBe('A logo.');
  });
});

describe('SouffleursProvider.chat — tool calls (LFM3)', () => {
  it('turns the calls of done into tool_use events, and drops one whose arguments are unreadable', async () => {
    vi.stubGlobal('console', { ...console, log: vi.fn(), warn: vi.fn() });
    const { SouffleursProvider } = await load();
    const request = {
      ...REQUEST,
      tools: [{ name: 'compute' }, { name: 'render' }, { name: 'write_file' }],
    } as unknown as AparteChatRequest;
    const reader = ((await SouffleursProvider.chat(request)) as ReadableStream).getReader();
    await tick();
    const worker = FakeWorker.last!;
    const chat = worker.posted.find((m) => m.type === 'chat') as
      (Posted & { tools: { function: { name: string } }[] }) | undefined;
    expect(chat!.tools.map((t) => t.function.name)).toEqual(['render', 'compute']); // the contract's
    worker.reply({ type: 'chunk', id: chat!.id, delta: 'Je calcule ça.' });
    worker.reply({
      type: 'done',
      id: chat!.id,
      usage: { inputTokens: 10, outputTokens: 4, ttftMs: 1, durationMs: 2 },
      toolCalls: [
        { name: 'compute', arguments: '{"expression":"2340 * 17 / 100"}' },
        { name: 'render', arguments: '{"kind":"pdf","task":"Fact' },
      ],
    });
    const events: { type: string; name?: string; input?: unknown }[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      events.push(value);
    }
    expect(events.map((e) => e.type)).toEqual(['text', 'tool_use', 'done']);
    expect(events[1]).toMatchObject({ name: 'compute', input: { expression: '2340 * 17 / 100' } });
  });

  it('says which call is being written until the turn ends', async () => {
    vi.stubGlobal('console', { ...console, log: vi.fn(), warn: vi.fn() });
    const { SouffleursProvider } = await load();
    const { getSouffleurStatus } = await import('./status');
    const request = { ...REQUEST, tools: [{ name: 'render' }] } as unknown as AparteChatRequest;
    const reader = ((await SouffleursProvider.chat(request)) as ReadableStream).getReader();
    await tick();
    const worker = FakeWorker.last!;
    const chat = worker.posted.find((m) => m.type === 'chat')!;
    worker.reply({ type: 'chunk', id: chat.id, delta: 'Je crée le tableau.' });
    worker.reply({ type: 'tool-start', id: chat.id, name: 'render' });
    expect(getSouffleurStatus()).toMatchObject({ status: 'generating', tool: 'render' });
    worker.reply({
      type: 'done',
      id: chat.id,
      usage: { inputTokens: 10, outputTokens: 4, ttftMs: 1, durationMs: 2 },
      toolCalls: [{ name: 'render', arguments: '{"kind":"xlsx","task":"Budget"}' }],
    });
    while (!(await reader.read()).done);
    expect(getSouffleurStatus().tool).toBeUndefined();
  });
});

describe('Stop before the turn starts', () => {
  it('a chat cancelled while still queued never reaches the engine', async () => {
    const { SouffleursProvider } = await load();
    const first = ((await SouffleursProvider.chat(REQUEST)) as ReadableStream).getReader();
    await tick();
    const worker = FakeWorker.last!;
    const [firstId] = worker.sentIds('chat');

    const second = ((await SouffleursProvider.chat(REQUEST)) as ReadableStream).getReader();
    await tick();
    await second.cancel(); // Stop while the first turn still holds the queue

    worker.reply({
      type: 'done',
      id: firstId,
      usage: { inputTokens: 1, outputTokens: 1, ttftMs: 1, durationMs: 1 },
    });
    await tick();
    await tick();
    void first;

    expect(worker.sentIds('chat')).toHaveLength(1);
  });
});

describe('the next turn read ahead after a document (6/11, M5)', () => {
  const PDF = { id: 'file_1', name: 'facture.pdf', type: 'pdf' };
  /** The closing turn of a document: the call and its result are in the history, the files are the old list. */
  const CLOSING = {
    messages: [
      { role: 'user', content: 'Une facture pour Dupont, 3 jours à 450 €.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'render', input: { kind: 'pdf', task: 'Facture Dupont' } }],
      },
      { role: 'tool', toolCallId: 'c1', content: '{"ok":true,"type":"pdf"}' },
    ],
    tools: [{ name: 'render' }],
    _meta: { souffleurFiles: [] },
  } as unknown as AparteChatRequest;
  const usage = { inputTokens: 10, outputTokens: 4, ttftMs: 1, durationMs: 2 };
  type Chat = Posted & {
    messages: { role: string; content: string }[];
    maxNewTokens: number;
    tools: unknown[];
  };
  const chats = (w: FakeWorker) => w.posted.filter((m) => m.type === 'chat') as Chat[];

  async function closeTurn(mod: Awaited<ReturnType<typeof load>>, toolCalls?: unknown[]) {
    const reader = ((await mod.SouffleursProvider.chat(CLOSING)) as ReadableStream).getReader();
    await tick();
    const worker = FakeWorker.last!;
    const [turn] = chats(worker);
    worker.reply({ type: 'chunk', id: turn!.id, delta: 'Voici ta facture.' });
    worker.reply({ type: 'done', id: turn!.id, usage, ...(toolCalls ? { toolCalls } : {}) });
    while (!(await reader.read()).done);
    await tick();
    return { worker, turn: turn! };
  }

  it("reads the next turn's prompt, with the new file in the system message, after a final answer", async () => {
    vi.stubGlobal('console', { ...console, log: vi.fn(), warn: vi.fn() });
    const mod = await load();
    mod.setNextTurnFiles(() => [PDF]);
    const { worker, turn } = await closeTurn(mod);
    const [, ahead] = chats(worker);
    expect(ahead?.maxNewTokens).toBe(1);
    expect(ahead!.messages[0]!.content).toContain(
      'Files available: [{"id":"file_1","name":"facture.pdf","type":"pdf"}]',
    );
    // the rest of the prompt is the closing turn's, so the follow-up finds it whole
    expect(ahead!.messages.slice(1)).toEqual(turn.messages.slice(1));
    expect(ahead!.tools).toEqual(turn.tools);
  });

  it('reads nothing ahead when the files did not change', async () => {
    vi.stubGlobal('console', { ...console, log: vi.fn(), warn: vi.fn() });
    const mod = await load();
    mod.setNextTurnFiles(() => []);
    const { worker } = await closeTurn(mod);
    expect(chats(worker)).toHaveLength(1);
  });

  it('reads nothing ahead after a turn that calls a tool: the loop goes on', async () => {
    vi.stubGlobal('console', { ...console, log: vi.fn(), warn: vi.fn() });
    const mod = await load();
    mod.setNextTurnFiles(() => [PDF]);
    const { worker } = await closeTurn(mod, [
      { name: 'compute', arguments: '{"expression":"1+1"}' },
    ]);
    expect(chats(worker)).toHaveLength(1);
  });

  it('a new turn stops the read-ahead, which never shows on the status', async () => {
    vi.stubGlobal('console', { ...console, log: vi.fn(), warn: vi.fn() });
    const mod = await load();
    const { getSouffleurStatus } = await import('./status');
    mod.setNextTurnFiles(() => [PDF]);
    const { worker } = await closeTurn(mod);
    const [, ahead] = chats(worker);
    expect(getSouffleurStatus().status).toBe('ready');

    void ((await mod.SouffleursProvider.chat(REQUEST)) as ReadableStream).getReader();
    await tick();
    expect(worker.posted.at(-1)?.type).toBe('abort');
    expect(chats(worker)).toHaveLength(2); // the new turn waits for the read-ahead to stop
    worker.reply({ type: 'done', id: ahead!.id, usage });
    await tick();
    expect(chats(worker)).toHaveLength(3);
  });

  it('a read-ahead still queued when a new turn arrives is never posted', async () => {
    vi.stubGlobal('console', { ...console, log: vi.fn(), warn: vi.fn() });
    const mod = await load();
    mod.setNextTurnFiles(() => [PDF]);
    const reader = ((await mod.SouffleursProvider.chat(CLOSING)) as ReadableStream).getReader();
    await tick();
    const worker = FakeWorker.last!;
    const [turn] = chats(worker);
    // the app's warm-up queued behind the closing turn, so the read-ahead queues behind it
    const warmed = mod.warmCaller(['render']);
    worker.reply({ type: 'done', id: turn!.id, usage });
    while (!(await reader.read()).done);
    await tick();
    await tick();
    const [, warm] = chats(worker);
    expect(warm?.maxNewTokens).toBe(1);
    expect(warm!.messages[0]!.content).not.toContain('Files available');

    void ((await mod.SouffleursProvider.chat(REQUEST)) as ReadableStream).getReader();
    await tick();
    worker.reply({ type: 'done', id: warm!.id, usage });
    await warmed;
    await tick();
    await tick();
    expect(worker.posted.some((m) => m.type === 'abort')).toBe(false);
    // the closing turn, the warm-up, the new turn — no prompt with the new file was ever sent
    expect(chats(worker)).toHaveLength(3);
    expect(chats(worker)[2]!.messages.at(-1)?.content).toBe('bonjour');
    expect(chats(worker).some((c) => c.messages[0]!.content.includes('Files available'))).toBe(
      false,
    );
  });
});

describe('the vision encoder joins the load at the turn that may read an image (6/11)', () => {
  const imageTurn = {
    messages: [{ role: 'user', content: 'Que vois-tu sur cette image ?' }],
    tools: [{ name: 'read_file' }],
    _meta: { souffleurFiles: [{ id: 'file_1', name: 'photo.png', type: 'image' }] },
  } as unknown as AparteChatRequest;
  type Chat = Posted & { mmprojFile?: string };

  it('a turn whose files hold an image, with WebGPU, brings the encoder once it is in the cache', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) }, language: 'fr' });
    const { SouffleursProvider } = await load();
    FakeWorker.last!.isCached = async () => true;
    void ((await SouffleursProvider.chat(imageTurn)) as ReadableStream).getReader();
    await tick();
    const chat = FakeWorker.last!.posted.find((m) => m.type === 'chat') as Chat;
    expect(chat.mmprojFile).toBe(MANIFEST.lfm3.mmproj.file);
  });

  it('no encoder while it is not in the cache: the description downloads it, with its progress', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) }, language: 'fr' });
    const { SouffleursProvider } = await load();
    void ((await SouffleursProvider.chat(imageTurn)) as ReadableStream).getReader();
    await tick();
    expect(
      (FakeWorker.last!.posted.find((m) => m.type === 'chat') as Chat).mmprojFile,
    ).toBeUndefined();
  });

  it('no encoder without an image, nor without WebGPU', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) }, language: 'fr' });
    const first = await load();
    void ((await first.SouffleursProvider.chat(REQUEST)) as ReadableStream).getReader();
    await tick();
    expect(
      (FakeWorker.last!.posted.find((m) => m.type === 'chat') as Chat).mmprojFile,
    ).toBeUndefined();

    vi.resetModules();
    vi.stubGlobal('navigator', { gpu: undefined, language: 'fr' });
    const second = await load();
    void ((await second.SouffleursProvider.chat(imageTurn)) as ReadableStream).getReader();
    await tick();
    expect(
      (FakeWorker.last!.posted.find((m) => m.type === 'chat') as Chat).mmprojFile,
    ).toBeUndefined();
  });

  it('the description carries the set, so a load it causes keeps the adapters', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) }, language: 'fr' });
    const { describeImage } = await load();
    void describeImage(new Blob(['x']), 'Describe.');
    await tick();
    await tick();
    const request = FakeWorker.last!.posted.find((m) => m.type === 'describe-image') as Posted & {
      setFiles?: Record<string, string>;
    };
    expect(request.setFiles).toEqual({
      'souffleur-chat': MANIFEST.lfm3.souffleurs.chat.file,
      'souffleur-pdf': MANIFEST.lfm3.souffleurs.pdf.file,
      'souffleur-xlsx-docx': MANIFEST.lfm3.souffleurs['xlsx-docx'].file,
      'souffleur-sandbox': MANIFEST.lfm3.souffleurs.sandbox.file,
    });
  });
});

describe('the status of a turn whose model is already loaded', () => {
  it('says generating once the engine is ready, not loading until the end', async () => {
    const { SouffleursProvider } = await load();
    const { getSouffleurStatus } = await import('./status');
    void ((await SouffleursProvider.chat(REQUEST)) as ReadableStream).getReader();
    await tick();
    const worker = FakeWorker.last!;
    const [id] = worker.sentIds('chat');
    expect(getSouffleurStatus().status).toBe('loading');
    worker.reply({ type: 'ready', id, adapter: 'souffleur-chat', ms: 0 });
    expect(getSouffleurStatus().status).toBe('generating');
  });
});
