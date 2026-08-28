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
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })),
  );

describe('SouffleurManifestClient', () => {
  it('loads the manifest in no-store and resolves files/versions', async () => {
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

  it('detection: hasUpdate until markSeen has remembered, not after', async () => {
    okFetch();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.hasUpdate('chat')).toBe(true);
    expect(m.updated()).toContain('chat');
    m.markSeen('chat');
    expect(m.hasUpdate('chat')).toBe(false);

    // New client (reboot): seen versions persisted.
    const m2 = new SouffleurManifestClient('https://hf.example/r');
    await m2.load();
    expect(m2.hasUpdate('chat')).toBe(false);
    expect(m2.hasUpdate('pdf')).toBe(true);
  });

  it('offline: falls back to the last known-good manifest', async () => {
    okFetch();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const m2 = new SouffleurManifestClient('https://hf.example/r');
    await m2.load();
    expect(m2.file('chat')).toBe('adapters/souffleur-chat-0.2.0.data');
  });

  it('first launch with no network or cache: legacy fallback (unversioned names)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.file('chat')).toBe('adapters/souffleur-chat.data');
    expect(m.version('chat')).toBe('legacy');
  });

  it('adapterRole maps adapter names to manifest roles', () => {
    expect(adapterRole('souffleur-chat')).toBe('chat');
    expect(adapterRole('souffleur-xlsx-docx')).toBe('xlsx-docx');
  });
});

/**
 * `vision` block: the detachable tower + the grafted graph that accepts it.
 * Since the grafted graph is bit-identical in text (measured logits gap:
 * 0.000e+00), it's used for EVERYTHING once published — text and vision then
 * only differ by `adapter.data`, like a souffleur swap.
 */
describe('SouffleurManifestClient — vision block', () => {
  const VISION = {
    version: '0.1.0',
    graph: 'onnx/model_vision_q4.onnx',
    tower: 'onnx/vision-tower-0.1.0.onnx',
    tower_data: 'onnx/vision-tower-0.1.0.onnx_data',
    tower_internal_data: 'embed_images_q4.onnx_data',
    size: 269_390_206,
  };

  it('vision published: modelFileName points to the grafted graph', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ ...MANIFEST, vision: VISION }), { status: 200 }),
      ),
    );
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    // 'onnx/model_vision_q4.onnx' -> 'model_vision' (tjs re-appends the dtype suffix)
    expect(m.modelFileName()).toBe('model_vision');
    expect(m.vision()?.tower).toBe('onnx/vision-tower-0.1.0.onnx');
    expect(m.vision()?.tower_internal_data).toBe('embed_images_q4.onnx_data');
    // Weights are NOT duplicated: vision shares base.weights.
    expect(m.baseWeightsFile()).toBe('onnx/model_q4.onnx_data');
  });

  it('vision absent: falls back to the text graph, nothing breaks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })),
    );
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.vision()).toBeNull();
    expect(m.modelFileName()).toBe('model');
  });

  it('legacy manifest (offline, never loaded): no vision', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.vision()).toBeNull();
    expect(m.modelFileName()).toBe('model');
  });
});

/**
 * Tower update flow. Vision is part of the model (not an option), so a
 * published tower never seen before must open the SAME modal as the
 * souffleurs. `markSeen()`/`hasUpdate()` only iterated over roles, so an
 * existing install was NEVER offered anything.
 */
describe('SouffleurManifestClient — tower update', () => {
  const VISION = {
    version: '0.1.0',
    graph: 'onnx/model_vision_q4.onnx',
    tower: 'onnx/vision-tower-0.1.0.onnx',
    tower_data: 'onnx/vision-tower-0.1.0.onnx_data',
    tower_internal_data: 'embed_images_q4.onnx_data',
    size: 269_390_206,
  };
  const withVision = (vision: unknown = VISION) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...MANIFEST, vision }), { status: 200 })),
    );

  it('tower never seen → update offered, then not after markSeenVision', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.visionHasUpdate()).toBe(true);
    m.markSeenVision();
    expect(m.visionHasUpdate()).toBe(false);

    // Reboot: the seen version is persisted.
    const m2 = new SouffleurManifestClient('https://hf.example/r');
    await m2.load();
    expect(m2.visionHasUpdate()).toBe(false);
  });

  it('tower bumped → re-offered', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    m.markSeenVision();

    withVision({ ...VISION, version: '0.2.0' });
    const m2 = new SouffleurManifestClient('https://hf.example/r');
    await m2.load();
    expect(m2.visionHasUpdate()).toBe(true);
  });

  it('global markSeen() also remembers the tower', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    m.markSeen();
    expect(m.visionHasUpdate()).toBe(false);
  });

  it('targeted markSeen(role) does NOT close the tower cycle', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    m.markSeen('chat');
    expect(m.visionHasUpdate()).toBe(true);
  });

  it('tower urls and weight resolved from the manifest', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/repo/resolve/main');
    await m.load();
    expect(m.visionUrls()).toEqual({
      graphUrl: 'https://hf.example/repo/resolve/main/onnx/vision-tower-0.1.0.onnx',
      dataUrl: 'https://hf.example/repo/resolve/main/onnx/vision-tower-0.1.0.onnx_data',
    });
    expect(m.visionSize()).toBe(269_390_206);
  });

  it('no tower published: nothing to offer, nothing to resolve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })),
    );
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.visionHasUpdate()).toBe(false);
    expect(m.visionUrls()).toBeNull();
    expect(m.visionSize()).toBe(0);
  });
});
