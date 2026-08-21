/**
 * Annulation en cours de génération : le worker répond `done` APRÈS la
 * fermeture du stream (`stopping.interrupt()` n'est vu qu'au token suivant).
 * Régression couverte ici : cet enqueue tardif jetait dans `onmessage`, donc
 * `resolve()` n'était jamais atteint et la file `_chain` restait bloquée à
 * vie — plus AUCUNE génération après un cancel.
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

  /** Réponse du worker vers le main thread. */
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

/** Laisse tourner les microtâches de la file (`_chain.then(op)`). */
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
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => MANIFEST })));
  vi.stubGlobal('navigator', { gpu: undefined, language: 'fr' });
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => vi.unstubAllGlobals());

describe('SouffleursProvider.chat — annulation', () => {
  it("le `done` tardif après cancel ne jette pas et libère la file", async () => {
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

    // Le worker avait déjà produit du texte + un tour complet : arrive APRÈS
    // la fermeture. Aucune exception ne doit sortir de onmessage.
    expect(() => {
      worker!.reply({ type: 'chunk', id: firstId, delta: 'du texte' });
      worker!.reply({
        type: 'done',
        id: firstId,
        usage: { inputTokens: 10, outputTokens: 2, ttftMs: 1, durationMs: 2 },
      });
    }).not.toThrow();

    // La file n'est pas bloquée : la génération suivante part bien.
    const second = (await SouffleursProvider.chat(REQUEST)) as ReadableStream;
    void second.getReader();
    await tick();
    expect(worker!.sentIds('generate').length).toBe(2);
  });

  it('sans annulation, le flux émet le texte puis done', async () => {
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
 * En dev on veut les traces du fil SANS avoir à activer quoi que ce soit —
 * demande explicite. `bp.debug` reste un override dans les deux sens.
 */
describe('verbosité du provider', () => {
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

  it('mode dev : traces actives sans flag', async () => {
    const log = await runTurn((m) => m.setSouffleurDebug(true));
    expect(wireLogged(log)).toBe(true);
  });

  it('mode prod : silencieux sans flag', async () => {
    const log = await runTurn((m) => m.setSouffleurDebug(false));
    expect(wireLogged(log)).toBe(false);
  });

  it("bp.debug='0' fait taire même en dev", async () => {
    lsStore.set('bp.debug', '0');
    const log = await runTurn((m) => m.setSouffleurDebug(true));
    expect(wireLogged(log)).toBe(false);
  });

  it("bp.debug='1' force même en prod", async () => {
    lsStore.set('bp.debug', '1');
    const log = await runTurn((m) => m.setSouffleurDebug(false));
    expect(wireLogged(log)).toBe(true);
  });
});
