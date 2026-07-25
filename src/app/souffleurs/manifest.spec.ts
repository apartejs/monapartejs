import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SouffleurManifestClient, adapterRole } from './manifest';

const MANIFEST = {
  schema: 'aparte-souffleurs/1',
  base: { rev: '2026-07-24', graph: 'onnx/model_q4.onnx', weights: 'onnx/model_q4.onnx_data' },
  souffleurs: {
    chat: { version: '0.2.0', file: 'adapters/souffleur-chat-0.2.0.data', size: 90544128 },
    pdf: { version: '0.1.0', file: 'adapters/souffleur-pdf-0.1.0.data', size: 90544128 },
    'xlsx-docx': { version: '0.1.0', file: 'adapters/souffleur-xlsx-docx-0.1.0.data' },
    sandbox: { version: '0.1.0', file: 'adapters/souffleur-sandbox-0.1.0.data' },
  },
};

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const okFetch = () =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })));

describe('SouffleurManifestClient', () => {
  it('charge le manifest en no-store et résout fichiers/versions', async () => {
    okFetch();
    const m = new SouffleurManifestClient('https://hf.example/repo/resolve/main/');
    await m.load();
    expect(vi.mocked(fetch).mock.calls[0]).toEqual([
      'https://hf.example/repo/resolve/main/manifest.json',
      { cache: 'no-store' },
    ]);
    expect(m.version('chat')).toBe('0.2.0');
    expect(m.file('chat')).toBe('adapters/souffleur-chat-0.2.0.data');
    expect(m.baseWeightsFile()).toBe('onnx/model_q4.onnx_data');
    expect(m.size('chat')).toBe(90544128);
  });

  it('détection : hasUpdate tant que markSeen n’a pas mémorisé, plus après', async () => {
    okFetch();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.hasUpdate('chat')).toBe(true);
    expect(m.updated()).toContain('chat');
    m.markSeen('chat');
    expect(m.hasUpdate('chat')).toBe(false);

    // Nouveau client (reboot) : versions vues persistées.
    const m2 = new SouffleurManifestClient('https://hf.example/r');
    await m2.load();
    expect(m2.hasUpdate('chat')).toBe(false);
    expect(m2.hasUpdate('pdf')).toBe(true);
  });

  it('hors-ligne : retombe sur le dernier manifest bon connu', async () => {
    okFetch();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const m2 = new SouffleurManifestClient('https://hf.example/r');
    await m2.load();
    expect(m2.file('chat')).toBe('adapters/souffleur-chat-0.2.0.data');
  });

  it('premier lancement sans réseau ni cache : fallback legacy (noms non versionnés)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.file('chat')).toBe('adapters/souffleur-chat.data');
    expect(m.version('chat')).toBe('legacy');
  });

  it('adapterRole mappe les noms d’adapters vers les rôles du manifest', () => {
    expect(adapterRole('souffleur-chat')).toBe('chat');
    expect(adapterRole('souffleur-xlsx-docx')).toBe('xlsx-docx');
  });
});
