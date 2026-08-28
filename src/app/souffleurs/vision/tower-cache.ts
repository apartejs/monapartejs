/**
 * Téléchargement caché de la tour vision — SANS onnxruntime.
 *
 * Module séparé exprès : le worker en a besoin pour obtenir les octets, et le
 * thread principal pour PRÉCHARGER la tour (flux de mise à jour). Importer
 * `vision-tower.ts` depuis le thread principal tirerait ORT dans le bundle
 * principal, ce qu'on ne veut pas — ici il n'y a que du `fetch` et le Cache API.
 */

/** Cache dédié : la tour ne passe pas par celui de transformers.js. */
export const TOWER_CACHE = 'aparte-vision-cache';

export type TowerProgress = (loaded: number, total: number, file: string) => void;

/** true si l'URL est déjà dans le cache (aucun réseau). */
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
 * Télécharge en réutilisant le Cache API : la tour ne descend qu'une fois,
 * qu'elle soit préchargée par le flux de MAJ ou tirée à la première image.
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
    /* Cache API indisponible : on télécharge sans cacher */
  }

  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`tour vision : ${name} ${res.status}`);
  if (cache) {
    try {
      await cache.put(url, res.clone());
    } catch {
      /* quota dépassé : on continue sans cacher */
    }
  }

  const total = Number(res.headers.get('content-length') ?? 0);
  if (!onProgress || !total || !res.body) return await res.arrayBuffer();

  // Lecture en flux pour une progression réelle (269 Mo, ça se voit).
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
 * Préchargement : met les deux fichiers de la tour en cache sans créer de
 * session ONNX (donc sans ORT, donc appelable côté UI). Fait partie du
 * téléchargement du modèle, comme les exécuteurs — pas une option.
 * Seul le RATTACHEMENT reste lazy (première image), conformément à ADR-001.
 */
export async function prefetchTower(
  urls: { graphUrl: string; dataUrl: string },
  onProgress?: TowerProgress,
): Promise<void> {
  await fetchTowerFile(urls.graphUrl, onProgress);
  await fetchTowerFile(urls.dataUrl, onProgress);
}
