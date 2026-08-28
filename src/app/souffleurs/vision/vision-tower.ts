/**
 * Tour vision — l'« encodeur détachable » d'ADR-001.
 *
 * C'est une session ONNX À PART, pas un modèle : elle se crée à la première
 * image et se relâche seule, sans toucher au décodeur. Le décodeur, lui, ne
 * swappe QUE son `adapter.data`, exactement comme pour un souffleur.
 *
 * Interface du graphe (`vision-tower-<ver>.onnx`, publié depuis
 * `bases/vl16b/r1/onnx/embed_images_q4.onnx`) :
 *   IN  pixel_values          FLOAT [batch, num_patches, 768]
 *       pixel_attention_mask  INT64 [batch, num_patches]
 *       spatial_shapes        INT64 [batch, 2]
 *   OUT image_features        FLOAT [num_image_tokens, 2048]
 *
 * `image_features` entre TEL QUEL dans l'entrée du même nom greffée sur notre
 * décodeur (`export/graft_image_embeds.py`) : même nom, même forme, même espace
 * hidden 2048 — c'est le même modèle texte, vérifié config + tenseurs.
 *
 * ORT est piloté directement ici parce que transformers.js ne sait pas charger
 * un graphe isolé de ce genre.
 *
 * ⚠️ COÛT ASSUMÉ, MESURÉ : le `dist` de @huggingface/transformers a ORT
 * **inliné**, et `env.backends.onnx` n'est qu'un objet de configuration — la
 * lib n'expose pas son `InferenceSession`. Cet import ajoute donc un SECOND
 * runtime ORT au chunk worker (vérifié : les littéraux d'erreur uniques d'ORT
 * y apparaissent 2×). Épingler la version ne change rien, le dédoublonnage
 * pnpm n'atteint pas un bundle déjà figé.
 * Ce qui est dupliqué, c'est du JS de runtime — PAS les poids : la base reste
 * un seul `model_q4.onnx_data`, une seule session décodeur, et le seul artefact
 * réseau en plus est la tour. C'est ce qui compte pour la VRAM et le download.
 * Alternative si ce surcoût devient gênant : créer la session via les internes
 * de la lib (`model.sessions`), au prix d'une dépendance à du non-public.
 */
import * as ort from 'onnxruntime-web';
import type { PreprocessedImage } from './image-preprocess';
import { fetchTowerFile, type TowerProgress } from './tower-cache';

export interface TowerSpec {
  /** URL absolue du graphe (`onnx/vision-tower-<ver>.onnx`). */
  graphUrl: string;
  /** URL absolue de l'external data versionnée. */
  dataUrl: string;
  /** Nom d'external data inscrit DANS le graphe — à mapper sur `dataUrl`. */
  internalDataName: string;
  device: 'webgpu' | 'wasm';
  onProgress?: TowerProgress;
}

export interface ImageEmbeddings {
  /** [numTokens * 2048] aplati, prêt pour `image_features`. */
  features: Float32Array;
  numTokens: number;
  hiddenSize: number;
}

let session: ort.InferenceSession | null = null;
let sessionKey: string | null = null;
let wasmConfigured = false;

/**
 * Chemins du runtime wasm de NOTRE instance ORT.
 *
 * ⚠️ SYMPTÔME VÉCU si on l'oublie : `WebAssembly.instantiate(): expected magic
 * word 00 61 73 6d, found 3c 21 44 4f` — `3c 21 44 4f` = « <!DO », c'est-à-dire
 * l'`index.html` renvoyé par le fallback SPA du dev server pour un `.wasm`
 * introuvable. transformers.js configure les chemins de SA copie d'ORT, pas de
 * la nôtre : sans ça la nôtre part sur un chemin relatif qui n'existe pas.
 * On reproduit donc exactement sa configuration (même CDN, même version).
 */
function ensureWasmPaths(): void {
  if (wasmConfigured) return;
  wasmConfigured = true;
  if (ort.env.wasm.wasmPaths) return; // déjà configuré (instance partagée)
  const version = ort.env.versions?.web;
  if (!version) return; // pas de web build : rien à configurer
  const prefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
  const isSafari =
    typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  ort.env.wasm.wasmPaths = isSafari
    ? {
        mjs: `${prefix}ort-wasm-simd-threaded.mjs`,
        wasm: `${prefix}ort-wasm-simd-threaded.wasm`,
      }
    : {
        mjs: `${prefix}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${prefix}ort-wasm-simd-threaded.asyncify.wasm`,
      };
}

/** true si la tour est actuellement rattachée. */
export function isTowerAttached(): boolean {
  return session !== null;
}

/**
 * Rattache la tour (idempotent). Une version différente force la recréation —
 * même règle que le swap d'un `.data` versionné.
 */
export async function attachTower(spec: TowerSpec): Promise<number> {
  if (session && sessionKey === spec.graphUrl) return 0;
  await detachTower();

  ensureWasmPaths();
  const t0 = performance.now();
  const graph = await fetchTowerFile(spec.graphUrl, spec.onProgress);
  const data = await fetchTowerFile(spec.dataUrl, spec.onProgress);

  session = await ort.InferenceSession.create(new Uint8Array(graph), {
    // Chaîne, jamais un seul EP : un souci WebGPU doit dégrader vers wasm au
    // lieu de faire échouer l'analyse d'image (c'est ce que fait la lib pour
    // le décodeur, via deviceToExecutionProviders).
    executionProviders: spec.device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    // `path` = la chaîne inscrite dans le graphe ; `data` = les octets réels.
    // Même indirection que `adapter.data` pour les souffleurs, ce qui permet de
    // versionner le fichier publié sans réécrire le graphe.
    externalData: [{ path: spec.internalDataName, data: new Uint8Array(data) }],
  });
  sessionKey = spec.graphUrl;
  return Math.round(performance.now() - t0);
}

/** Détache la tour et rend sa mémoire. Le décodeur n'est pas touché. */
export async function detachTower(): Promise<void> {
  if (!session) return;
  try {
    await session.release();
  } catch {
    /* déjà relâchée */
  }
  session = null;
  sessionKey = null;
}

/** Encode une image prétraitée en embeds prêts pour le décodeur. */
export async function encodeImage(image: PreprocessedImage): Promise<ImageEmbeddings> {
  if (!session) throw new Error('tour vision non rattachée');

  const [numTiles, patchesPerTile] = image.shape;
  const outputs = await session.run({
    pixel_values: new ort.Tensor('float32', image.pixelValues, image.shape),
    pixel_attention_mask: new ort.Tensor('int64', image.attentionMask, [numTiles, patchesPerTile]),
    spatial_shapes: new ort.Tensor('int64', image.spatialShapes, [numTiles, 2]),
  });

  const tensor = outputs['image_features'];
  if (!tensor) throw new Error('tour vision : sortie image_features absente');
  const dims = tensor.dims as number[];
  const hiddenSize = dims[dims.length - 1];
  const features = tensor.data as Float32Array;
  return { features, numTokens: features.length / hiddenSize, hiddenSize };
}
