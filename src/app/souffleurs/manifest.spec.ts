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

/**
 * Bloc `vision` : la tour détachable + le graphe greffé qui l'accepte.
 * Le graphe greffé étant bit-identique en texte (écart de logits mesuré :
 * 0.000e+00), il sert pour TOUT dès qu'il est publié — texte et vision ne
 * diffèrent alors plus que par `adapter.data`, comme un swap de souffleur.
 */
describe('SouffleurManifestClient — bloc vision', () => {
  const VISION = {
    version: '0.1.0',
    graph: 'onnx/model_vision_q4.onnx',
    tower: 'onnx/vision-tower-0.1.0.onnx',
    tower_data: 'onnx/vision-tower-0.1.0.onnx_data',
    tower_internal_data: 'embed_images_q4.onnx_data',
    size: 269_390_206,
  };

  it('vision publiée : modelFileName pointe le graphe greffé', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...MANIFEST, vision: VISION }), { status: 200 })),
    );
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    // 'onnx/model_vision_q4.onnx' -> 'model_vision' (tjs recolle le suffixe dtype)
    expect(m.modelFileName()).toBe('model_vision');
    expect(m.vision()?.tower).toBe('onnx/vision-tower-0.1.0.onnx');
    expect(m.vision()?.tower_internal_data).toBe('embed_images_q4.onnx_data');
    // Les poids ne sont PAS dupliqués : la vision partage base.weights.
    expect(m.baseWeightsFile()).toBe('onnx/model_q4.onnx_data');
  });

  it('vision absente : on retombe sur le graphe texte, rien ne casse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })),
    );
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.vision()).toBeNull();
    expect(m.modelFileName()).toBe('model');
  });

  it('manifest legacy (hors-ligne, jamais chargé) : pas de vision', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.vision()).toBeNull();
    expect(m.modelFileName()).toBe('model');
  });
});

/**
 * Flux de mise à jour de la tour. La vision fait partie du modèle (pas une
 * option), donc une tour publiée jamais vue doit ouvrir le MÊME modal que les
 * souffleurs. `markSeen()`/`hasUpdate()` n'itéraient que sur les rôles, donc
 * une install existante ne se voyait JAMAIS rien proposer.
 */
describe('SouffleurManifestClient — mise à jour de la tour', () => {
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

  it('tour jamais vue → mise à jour proposée, puis plus après markSeenVision', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.visionHasUpdate()).toBe(true);
    m.markSeenVision();
    expect(m.visionHasUpdate()).toBe(false);

    // Reboot : la version vue est persistée.
    const m2 = new SouffleurManifestClient('https://hf.example/r');
    await m2.load();
    expect(m2.visionHasUpdate()).toBe(false);
  });

  it('tour bumpée → reproposée', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    m.markSeenVision();

    withVision({ ...VISION, version: '0.2.0' });
    const m2 = new SouffleurManifestClient('https://hf.example/r');
    await m2.load();
    expect(m2.visionHasUpdate()).toBe(true);
  });

  it('markSeen() global mémorise aussi la tour', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    m.markSeen();
    expect(m.visionHasUpdate()).toBe(false);
  });

  it('markSeen(role) ciblé ne clôt PAS le cycle de la tour', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    m.markSeen('chat');
    expect(m.visionHasUpdate()).toBe(true);
  });

  it('urls et poids de la tour résolus depuis le manifest', async () => {
    withVision();
    const m = new SouffleurManifestClient('https://hf.example/repo/resolve/main');
    await m.load();
    expect(m.visionUrls()).toEqual({
      graphUrl: 'https://hf.example/repo/resolve/main/onnx/vision-tower-0.1.0.onnx',
      dataUrl: 'https://hf.example/repo/resolve/main/onnx/vision-tower-0.1.0.onnx_data',
    });
    expect(m.visionSize()).toBe(269_390_206);
  });

  it('pas de tour publiée : rien à proposer, rien à résoudre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 })));
    const m = new SouffleurManifestClient('https://hf.example/r');
    await m.load();
    expect(m.visionHasUpdate()).toBe(false);
    expect(m.visionUrls()).toBeNull();
    expect(m.visionSize()).toBe(0);
  });
});
