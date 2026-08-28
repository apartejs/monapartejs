/**
 * Cached download of the vision tower — WITHOUT onnxruntime.
 *
 * Separate module on purpose: the worker needs it to get the bytes, and the
 * main thread to PREFETCH the tower (update flow). Importing
 * `vision-tower.ts` from the main thread would pull ORT into the main
 * bundle, which we don't want — here there's only `fetch` and the Cache API.
 */

/** Dedicated cache: the tower doesn't go through transformers.js's. */
export const TOWER_CACHE = 'aparte-vision-cache';

export type TowerProgress = (loaded: number, total: number, file: string) => void;

/** true if the URL is already in the cache (no network). */
export async function isTowerCached(urls: string[]): Promise<boolean> {
  try {
    const cache = await caches.open(TOWER_CACHE);
    for (const url of urls) {
      if (!(await cache.match(url))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads while reusing the Cache API: the tower only comes down once,
 * whether it's prefetched by the update flow or pulled on the first image.
 */
export async function fetchTowerFile(
  url: string,
  onProgress?: TowerProgress,
): Promise<ArrayBuffer> {
  const name = url.split('/').pop() ?? url;
  let cache: Cache | null = null;
  try {
    cache = await caches.open(TOWER_CACHE);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    /* Cache API unavailable: download without caching */
  }

  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`tour vision : ${name} ${res.status}`);
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch {
      /* quota exceeded: continue without caching */
    }
  }

  const total = Number(res.headers.get('content-length') ?? 0);
  if (!onProgress || !total || !res.body) return await res.arrayBuffer();

  // Streamed read for real progress (269 MB, it's noticeable).
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total, name);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

/**
 * Prefetch: puts the tower's two files in cache without creating an ONNX
 * session (so without ORT, so callable from the UI side). Part of the model
 * download, like the executors — not an option.
 * Only ATTACHMENT stays lazy (first image), per ADR-001.
 */
export async function prefetchTower(
  urls: { graphUrl: string; dataUrl: string },
  onProgress?: TowerProgress,
): Promise<void> {
  await fetchTowerFile(urls.graphUrl, onProgress);
  await fetchTowerFile(urls.dataUrl, onProgress);
}
