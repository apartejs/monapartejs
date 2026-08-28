/**
 * Vision tower — ADR-001's "detachable encoder".
 *
 * It's a SEPARATE ONNX session, not a model: it's created on the first image
 * and releases itself, without touching the decoder. The decoder, on the
 * other hand, only swaps its `adapter.data`, exactly like a souffleur.
 *
 * Graph interface (`vision-tower-<ver>.onnx`, published from
 * `bases/vl16b/r1/onnx/embed_images_q4.onnx`):
 *   IN  pixel_values          FLOAT [batch, num_patches, 768]
 *       pixel_attention_mask  INT64 [batch, num_patches]
 *       spatial_shapes        INT64 [batch, 2]
 *   OUT image_features        FLOAT [num_image_tokens, 2048]
 *
 * `image_features` goes in AS-IS into the same-named input grafted onto our
 * decoder (`export/graft_image_embeds.py`): same name, same shape, same 2048
 * hidden space — it's the same text model, verified via config + tensors.
 *
 * ORT is driven directly here because transformers.js doesn't know how to
 * load an isolated graph of this kind.
 *
 * ⚠️ ACCEPTED, MEASURED COST: @huggingface/transformers's `dist` has ORT
 * **inlined**, and `env.backends.onnx` is only a config object — the lib
 * doesn't expose its `InferenceSession`. This import therefore adds a SECOND
 * ORT runtime to the worker chunk (verified: ORT's unique error literals
 * appear there 2×). Pinning the version changes nothing, pnpm dedup doesn't
 * reach an already-frozen bundle.
 * What's duplicated is runtime JS — NOT the weights: the base stays a single
 * `model_q4.onnx_data`, a single decoder session, and the only extra network
 * artifact is the tower. That's what matters for VRAM and download size.
 * Alternative if this overhead becomes an issue: create the session via the
 * lib's internals (`model.sessions`), at the cost of depending on something
 * non-public.
 */
import * as ort from 'onnxruntime-web';
import type { PreprocessedImage } from './image-preprocess';
import { fetchTowerFile, type TowerProgress } from './tower-cache';

export interface TowerSpec {
  /** Absolute URL of the graph (`onnx/vision-tower-<ver>.onnx`). */
  graphUrl: string;
  /** Absolute URL of the versioned external data. */
  dataUrl: string;
  /** External data name registered INSIDE the graph — to be mapped onto `dataUrl`. */
  internalDataName: string;
  device: 'webgpu' | 'wasm';
  onProgress?: TowerProgress;
}

export interface ImageEmbeddings {
  /** [numTokens * 2048] flattened, ready for `image_features`. */
  features: Float32Array;
  numTokens: number;
  hiddenSize: number;
}

let session: ort.InferenceSession | null = null;
let sessionKey: string | null = null;
let wasmConfigured = false;

/**
 * Wasm runtime paths for OUR ORT instance.
 *
 * ⚠️ SYMPTOM SEEN FIRSTHAND if forgotten: `WebAssembly.instantiate(): expected
 * magic word 00 61 73 6d, found 3c 21 44 4f` — `3c 21 44 4f` = "<!DO", i.e.
 * the `index.html` returned by the dev server's SPA fallback for a `.wasm`
 * not found. transformers.js configures the paths of ITS OWN copy of ORT,
 * not ours: without this, ours ends up on a relative path that doesn't
 * exist. So we reproduce its configuration exactly (same CDN, same version).
 */
function ensureWasmPaths(): void {
  if (wasmConfigured) return;
  wasmConfigured = true;
  if (ort.env.wasm.wasmPaths) return; // already configured (shared instance)
  const version = ort.env.versions?.web;
  if (!version) return; // no web build: nothing to configure
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

/** true if the tower is currently attached. */
export function isTowerAttached(): boolean {
  return session !== null;
}

/**
 * Attaches the tower (idempotent). A different version forces recreation —
 * same rule as swapping a versioned `.data`.
 */
export async function attachTower(spec: TowerSpec): Promise<number> {
  if (session && sessionKey === spec.graphUrl) return 0;
  await detachTower();

  ensureWasmPaths();
  const t0 = performance.now();
  const graph = await fetchTowerFile(spec.graphUrl, spec.onProgress);
  const data = await fetchTowerFile(spec.dataUrl, spec.onProgress);

  session = await ort.InferenceSession.create(new Uint8Array(graph), {
    // A chain, never a single EP: a WebGPU issue must degrade to wasm
    // instead of failing image analysis outright (this is what the lib does
    // for the decoder, via deviceToExecutionProviders).
    executionProviders: spec.device === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    // `path` = the string registered in the graph; `data` = the actual bytes.
    // Same indirection as `adapter.data` for the souffleurs, which allows
    // versioning the published file without rewriting the graph.
    externalData: [{ path: spec.internalDataName, data: new Uint8Array(data) }],
  });
  sessionKey = spec.graphUrl;
  return Math.round(performance.now() - t0);
}

/** Detaches the tower and frees its memory. The decoder isn't touched. */
export async function detachTower(): Promise<void> {
  if (!session) return;
  try {
    await session.release();
  } catch {
    /* already released */
  }
  session = null;
  sessionKey = null;
}

/** Encodes a preprocessed image into embeds ready for the decoder. */
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
