/**
 * Prétraitement d'image pour la tour vision — port de `Lfm2VlImageProcessorFast`.
 * Référence portée : `lfm2-vl-space/vl-processor.js` (démo VL in-browser qui
 * tourne), elle-même alignée sur le processeur Python.
 *
 * Produit les TROIS tenseurs que `vision-tower` attend, exactement dans les
 * formes déclarées par le graphe :
 *   pixel_values         FLOAT [num_tiles, 1024, 768]
 *   pixel_attention_mask INT64 [num_tiles, 1024]
 *   spatial_shapes       INT64 [num_tiles, 2]
 *
 * Un « patch » = 16×16 px aplati en 768 valeurs (16·16·3), normalisé
 * (pixel/255 − 0.5)/0.5 = pixel/127.5 − 1.
 *
 * ⚠️ PÉRIMÈTRE : seul le chemin MONO-TUILE est porté (smart resize, pas de
 * découpage en tuiles + thumbnail). `smartResize` borne déjà l'image à
 * maxImageTokens, donc toute image passe — une très grande photo est
 * simplement redimensionnée au lieu d'être découpée, ce qui coûte un peu de
 * finesse sur les détails, jamais la correction. Le chemin haute résolution
 * (`_high_res_preprocessor`) reste à porter si le besoin apparaît.
 *
 * Worker-safe : `createImageBitmap` + `OffscreenCanvas` (pas de `document`).
 */

/** Valeurs de `bases/vl16b/r1/preprocessor_config.json`. */
const CONFIG = {
  patchSize: 16,
  /** 512/16 — borne d'indexation des tableaux de sortie. */
  patchesPerTile: 32,
  downsampleFactor: 2,
  minImageTokens: 64,
  maxImageTokens: 256,
} as const;

/** (pixel/255 − 0.5)/0.5 = pixel/127.5 − 1 — mean/std valent 0.5 dans le config. */
const NORM_SCALE = 1 / 127.5;
const NORM_OFFSET = -1;

export interface PreprocessedImage {
  pixelValues: Float32Array;
  attentionMask: BigInt64Array;
  spatialShapes: BigInt64Array;
  numTiles: number;
  /** [num_tiles, patches_per_tile, patch_dim] */
  shape: [number, number, number];
  /** Dimensions réellement soumises à la tour (après smart resize). */
  width: number;
  height: number;
}

const roundByFactor = (n: number, f: number) => Math.round(n / f) * f;
const ceilByFactor = (n: number, f: number) => Math.ceil(n / f) * f;
const floorByFactor = (n: number, f: number) => Math.floor(n / f) * f;

/**
 * Dimensions divisibles par patchSize·downsampleFactor (32) et nombre total de
 * pixels borné dans [minPixels, maxPixels] — port de `_smart_resize()`.
 */
export function smartResize(width: number, height: number): { width: number; height: number } {
  const { patchSize, downsampleFactor, minImageTokens, maxImageTokens } = CONFIG;
  const totalFactor = patchSize * downsampleFactor; // 32
  const unit = patchSize ** 2 * downsampleFactor ** 2; // 1024 px par token
  const minPixels = minImageTokens * unit;
  const maxPixels = maxImageTokens * unit;

  let hBar = Math.max(totalFactor, roundByFactor(height, totalFactor));
  let wBar = Math.max(totalFactor, roundByFactor(width, totalFactor));

  if (hBar * wBar > maxPixels) {
    const beta = Math.sqrt((height * width) / maxPixels);
    hBar = Math.max(totalFactor, floorByFactor(height / beta, totalFactor));
    wBar = Math.max(totalFactor, floorByFactor(width / beta, totalFactor));
  } else if (hBar * wBar < minPixels) {
    const beta = Math.sqrt(minPixels / (height * width));
    hBar = ceilByFactor(height * beta, totalFactor);
    wBar = ceilByFactor(width * beta, totalFactor);
  }
  return { width: wBar, height: hBar };
}

/**
 * Nombre de tokens d'image attendu — port de `_get_tokens_num()`. Sert de
 * CONTRÔLE : la tour renvoie le compte réel, et un écart signale une
 * divergence de prétraitement (donc un prompt hors distribution).
 */
export function expectedImageTokens(width: number, height: number): number {
  const { patchSize, downsampleFactor } = CONFIG;
  const h = Math.floor(height / patchSize);
  const w = Math.floor(width / patchSize);
  return Math.ceil(h / downsampleFactor) * Math.ceil(w / downsampleFactor);
}

export async function preprocessImage(blob: Blob): Promise<PreprocessedImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = smartResize(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d indisponible');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    const { patchSize, patchesPerTile } = CONFIG;
    const maxPatches = patchesPerTile * patchesPerTile; // 1024
    const patchDim = patchSize * patchSize * 3; // 768
    const patchesH = height / patchSize;
    const patchesW = width / patchSize;

    if (patchesH * patchesW > maxPatches) {
      // smartResize borne à maxImageTokens -> ne doit jamais arriver ; si ça
      // arrive, mieux vaut échouer clairement que déborder silencieusement.
      throw new Error(
        `prétraitement : ${patchesH * patchesW} patches > ${maxPatches} (smartResize a échoué)`,
      );
    }

    const pixelValues = new Float32Array(maxPatches * patchDim);
    const attentionMask = new BigInt64Array(maxPatches);
    const spatialShapes = new BigInt64Array(2);

    extractPatches(imageData, pixelValues, attentionMask, patchesH, patchesW);
    spatialShapes[0] = BigInt(patchesH);
    spatialShapes[1] = BigInt(patchesW);

    return {
      pixelValues,
      attentionMask,
      spatialShapes,
      numTiles: 1,
      shape: [1, maxPatches, patchDim],
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Aplatit chaque patch 16×16 en 768 valeurs normalisées, marque les patches
 * valides à 1 et laisse le reste du tableau à zéro / masque 0 (padding).
 */
function extractPatches(
  imageData: ImageData,
  pixelValues: Float32Array,
  attentionMask: BigInt64Array,
  patchesH: number,
  patchesW: number,
): void {
  const { patchSize } = CONFIG;
  const patchDim = patchSize * patchSize * 3;
  const pixels = imageData.data;
  const imageWidth = imageData.width;

  let patchIdx = 0;
  for (let py = 0; py < patchesH; py++) {
    for (let px = 0; px < patchesW; px++) {
      const startX = px * patchSize;
      const startY = py * patchSize;
      attentionMask[patchIdx] = 1n;

      let out = patchIdx * patchDim;
      for (let dy = 0; dy < patchSize; dy++) {
        const rowOffset = (startY + dy) * imageWidth;
        for (let dx = 0; dx < patchSize; dx++) {
          const src = (rowOffset + startX + dx) * 4;
          pixelValues[out++] = pixels[src] * NORM_SCALE + NORM_OFFSET;
          pixelValues[out++] = pixels[src + 1] * NORM_SCALE + NORM_OFFSET;
          pixelValues[out++] = pixels[src + 2] * NORM_SCALE + NORM_OFFSET;
        }
      }
      patchIdx++;
    }
  }
}
