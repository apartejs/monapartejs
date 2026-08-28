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

  sentIds(type: string): number[] {
    return this.posted.filter((m) => m.type === type).map((m) => m.id as number);
  }
}

const REQUEST = {
  messages: [{ role: 'user', content: 'bonjour' }],
} as unknown as AparteChatRequest;

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
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => vi.unstubAllGlobals());

describe('SouffleursProvider.chat — cancellation', () => {
  it('the late `done` after cancel does not throw and releases the queue', async () => {
    const { SouffleursProvider } = await import('./souffleurs-provider');

    const stream = (await SouffleursProvider.chat(REQUEST)) as ReadableStream;
    const reader = stream.getReader();
    await tick();

    const worker = FakeWorker.last;
    expect(worker).not.toBeNull();
    const [firstId] = worker!.sentIds('generate');
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
    expect(worker!.sentIds('generate').length).toBe(2);
  });

  it('without cancellation, the stream emits text then done', async () => {
    const { SouffleursProvider } = await import('./souffleurs-provider');

    const stream = (await SouffleursProvider.chat(REQUEST)) as ReadableStream;
    const reader = stream.getReader();
    await tick();

    const worker = FakeWorker.last!;
    const [id] = worker.sentIds('generate');
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
    const { runExecutor } = await import('./souffleurs-provider');
    const pending = runExecutor('souffleur-sandbox', 'SYSTEM', 'somme de 1 à 10');
    await tick();
    await tick();
    const worker = FakeWorker.last!;
    const generate = worker.posted.find((m) => m.type === 'generate') as
      (Posted & { prompt: string }) | undefined;
    expect(generate).toBeDefined();
    expect(generate!.prompt).toContain('user\nintent: somme de 1 à 10');
    expect(generate!.prompt).not.toContain('user\nsomme de 1 à 10');
    worker.reply({
      type: 'done',
      id: generate!.id,
      usage: { inputTokens: 5, outputTokens: 1, ttftMs: 1, durationMs: 2 },
    });
    await pending;
  });
});

/**
 * The conversation's Stop aborts the tool handler's signal; the executor must
 * stop the worker and reject as an AbortError (what the engine expects).
 */
describe('runExecutor — abort', () => {
  it('posts `abort` to the worker and rejects with AbortError', async () => {
    const { runExecutor } = await import('./souffleurs-provider');
    const controller = new AbortController();
    const pending = runExecutor('souffleur-pdf', 'SYSTEM', 'facture', {
      signal: controller.signal,
    });
    await tick();
    await tick();
    const worker = FakeWorker.last!;
    expect(worker.sentIds('generate').length).toBe(1);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.posted.some((m) => m.type === 'abort')).toBe(true);

    // The worker still answers `done` after the interrupt: must not throw.
    const [id] = worker.sentIds('generate');
    expect(() =>
      worker.reply({
        type: 'done',
        id,
        usage: { inputTokens: 1, outputTokens: 1, ttftMs: 1, durationMs: 1 },
      }),
    ).not.toThrow();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { runExecutor } = await import('./souffleurs-provider');
    const controller = new AbortController();
    controller.abort();
    await expect(
      runExecutor('souffleur-pdf', 'SYSTEM', 'facture', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.last?.sentIds('generate') ?? []).toEqual([]);
  });
});

/**
 * In dev we want the wire traces WITHOUT having to enable anything —
 * explicit request. `bp.debug` remains an override in both directions.
 */
describe('provider verbosity', () => {
  const wireLogged = (spy: ReturnType<typeof vi.fn>) =>
    spy.mock.calls.some((c) => String(c[0]).includes('PROMPT WIRE'));

  async function runTurn(configure: (m: typeof import('./souffleurs-provider')) => void) {
    const mod = await import('./souffleurs-provider');
    configure(mod);
    const log = vi.fn();
    vi.stubGlobal('console', { ...console, log, warn: vi.fn() });
    const stream = (await mod.SouffleursProvider.chat(REQUEST)) as ReadableStream;
    void stream.getReader();
    await tick();
    const worker = FakeWorker.last!;
    const [id] = worker.sentIds('generate');
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
