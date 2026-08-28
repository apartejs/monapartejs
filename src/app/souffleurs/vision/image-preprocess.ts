/**
 * Prétraitement d'image pour la tour vision — port de `Lfm2VlImageProcessorFast`.
 *
 * Référence portée : l'implémentation PYTHON de `transformers`
 * (`models/lfm2_vl/image_processing_lfm2_vl.py` + `processing_lfm2_vl.py`),
 * pas le portage transformers.js. Ce dernier redimensionne l'image à la
 * `size` du config (512×512) AVANT de décider s'il faut découper, ce qui rend
 * la condition « image trop grande » toujours fausse : il ne découpe jamais.
 * Le Python, lui, décide sur les dimensions D'ORIGINE. Vérifié en lisant les
 * deux le 21/08.
 *
 * Produit les TROIS tenseurs que `vision-tower` attend :
 *   pixel_values         FLOAT [num_tiles, 1024, 768]
 *   pixel_attention_mask INT64 [num_tiles, 1024]
 *   spatial_shapes       INT64 [num_tiles, 2]
 *
 * Un « patch » = 16×16 px aplati en 768 valeurs (16·16·3), normalisé
 * (pixel/255 − 0.5)/0.5 = pixel/127.5 − 1.
 *
 * DEUX CHEMINS, comme la référence :
 *
 *  - image raisonnable -> une tuile, simple smart resize ;
 *  - image trop grande -> grille de tuiles de 512×512 découpées dans l'image
 *    redimensionnée au ratio le plus proche, PLUS une vignette d'ensemble en
 *    dernière position. Sans ce chemin, une capture d'écran ou un document
 *    photographié était écrasé à 256 tokens : le texte fin disparaissait avant
 *    même d'atteindre le modèle.
 *
 * L'ORDRE des tuiles est normatif — ligne par ligne, vignette en dernier. Il
 * doit correspondre exactement à l'ordre des marqueurs du prompt
 * (`<|img_row_R_col_C|>` … `<|img_thumbnail|>`), sinon les embeds atterrissent
 * sur les mauvaises positions et le modèle décrit une image qui n'existe pas.
 *
 * Worker-safe : `createImageBitmap` + `OffscreenCanvas` (pas de `document`).
 */

/** Valeurs de `processor_config.json` du dépôt LFM2.5-VL — toutes vérifiées. */
const CONFIG = {
  patchSize: 16,
  /** 512/16 — une tuile pleine fait 32×32 patches, soit exactement maxPatches. */
  patchesPerTile: 32,
  downsampleFactor: 2,
  minImageTokens: 64,
  maxImageTokens: 256,
  tileSize: 512,
  minTiles: 2,
  maxTiles: 10,
  /** Marge avant de découper : une image peut dépasser d'un facteur 2 sans l'être. */
  maxPixelsTolerance: 2.0,
  useThumbnail: true,
} as const;

/** (pixel/255 − 0.5)/0.5 = pixel/127.5 − 1 — mean/std valent 0.5 dans le config. */
const NORM_SCALE = 1 / 127.5;
const NORM_OFFSET = -1;

/** 1024 : max(maxImageTokens·downsample², (tileSize/patchSize)²) — les deux valent 1024. */
const MAX_PATCHES = CONFIG.patchesPerTile * CONFIG.patchesPerTile;
const PATCH_DIM = CONFIG.patchSize * CONFIG.patchSize * 3;

export interface PreprocessedImage {
  pixelValues: Float32Array;
  attentionMask: BigInt64Array;
  spatialShapes: BigInt64Array;
  numTiles: number;
  /** [num_tiles, patches_per_tile, patch_dim] */
  shape: [number, number, number];
  /** Grille de découpage. 1×1 = chemin mono-tuile, pas de vignette. */
  rows: number;
  cols: number;
  /**
   * Dimensions de la VIGNETTE (chemin mono-tuile : de l'unique tuile). C'est
   * d'elles que dépend le nombre de tokens de la vignette.
   */
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
 * L'image mérite-t-elle d'être découpée ? Port de `_is_image_too_large()`.
 *
 * Sur les dimensions D'ORIGINE, jamais sur une image déjà redimensionnée —
 * c'est l'erreur du portage transformers.js. Seuil : 256 tokens × 1024 px par
 * token × 2 de tolérance = 524 288 px, soit un peu plus que 720×720.
 */
export function isImageTooLarge(width: number, height: number): boolean {
  const { patchSize, downsampleFactor, maxImageTokens, maxPixelsTolerance } = CONFIG;
  const totalFactor = patchSize * downsampleFactor;
  const hBar = Math.max(patchSize, roundByFactor(height, totalFactor));
  const wBar = Math.max(patchSize, roundByFactor(width, totalFactor));
  return hBar * wBar > maxImageTokens * totalFactor ** 2 * maxPixelsTolerance;
}

/** Toutes les grilles w×h dont le produit tient dans [minTiles, maxTiles]. */
function targetRatios(minTiles: number, maxTiles: number): [number, number][] {
  const seen = new Set<number>();
  const ratios: [number, number][] = [];
  for (let n = minTiles; n <= maxTiles; n++) {
    for (let w = 1; w <= n; w++) {
      for (let h = 1; h <= n; h++) {
        const product = w * h;
        if (product < minTiles || product > maxTiles) continue;
        const key = (w << 16) | h;
        if (seen.has(key)) continue;
        seen.add(key);
        ratios.push([w, h]);
      }
    }
  }
  return ratios.sort((a, b) => a[0] * a[1] - b[0] * b[1]);
}

/**
 * Grille dont le rapport d'aspect approche le mieux celui de l'image.
 * À égalité de rapport, la référence préfère la grille la PLUS GRANDE si
 * l'image est assez grande pour la remplir à moitié — d'où la seconde branche.
 */
function findClosestAspectRatio(
  aspect: number,
  ratios: readonly [number, number][],
  width: number,
  height: number,
  tileSize: number,
): [number, number] {
  let best: [number, number] = [1, 1];
  let bestDiff = Infinity;
  const area = width * height;
  for (const ratio of ratios) {
    const diff = Math.abs(aspect - ratio[0] / ratio[1]);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ratio;
    } else if (diff === bestDiff && area > 0.5 * tileSize * tileSize * ratio[0] * ratio[1]) {
      best = ratio;
    }
  }
  return best;
}

/** Port de `_get_grid_layout()`. `cols` = grid_width, `rows` = grid_height. */
export function gridLayout(
  width: number,
  height: number,
): { cols: number; rows: number; targetWidth: number; targetHeight: number } {
  const { minTiles, maxTiles, tileSize } = CONFIG;
  const [cols, rows] = findClosestAspectRatio(
    width / height,
    targetRatios(minTiles, maxTiles),
    width,
    height,
    tileSize,
  );
  return { cols, rows, targetWidth: tileSize * cols, targetHeight: tileSize * rows };
}

/**
 * Nombre de tokens produits par une image de ces dimensions — port de
 * `_compute_tokens_for_image()`. Vaut pour l'unique tuile comme pour la
 * vignette.
 */
export function expectedImageTokens(width: number, height: number): number {
  const { patchSize, downsampleFactor } = CONFIG;
  const h = Math.floor(height / patchSize);
  const w = Math.floor(width / patchSize);
  return Math.ceil(h / downsampleFactor) * Math.ceil(w / downsampleFactor);
}

/** Tokens d'une tuile pleine — `_compute_tokens_per_tile()`. 512/16/2 au carré = 256. */
export const TOKENS_PER_TILE = (() => {
  const patches = CONFIG.tileSize / CONFIG.patchSize;
  return Math.ceil(patches / CONFIG.downsampleFactor) ** 2;
})();

/**
 * Total attendu pour une image prétraitée : les tuiles pleines plus la
 * vignette. Sert de CONTRÔLE face au compte réel renvoyé par la tour — un
 * écart signale une divergence de prétraitement, donc un prompt hors
 * distribution, et c'est exactement ce qu'on veut voir en développement.
 */
export function expectedTotalTokens(image: PreprocessedImage): number {
  const tiles = image.rows * image.cols;
  const thumbnail = expectedImageTokens(image.width, image.height);
  return tiles > 1 ? tiles * TOKENS_PER_TILE + thumbnail : thumbnail;
}

export async function preprocessImage(blob: Blob): Promise<PreprocessedImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const thumb = smartResize(bitmap.width, bitmap.height);
    const split = isImageTooLarge(bitmap.width, bitmap.height);
    const grid = split ? gridLayout(bitmap.width, bitmap.height) : null;

    // Une tuile par case de la grille, plus la vignette d'ensemble. La
    // référence n'ajoute la vignette que si la grille n'est pas 1×1 ; nos
    // bornes (minTiles = 2) l'excluent déjà, mais la garde reste alignée.
    const tiles: ImageData[] = [];
    if (grid && grid.cols * grid.rows !== 1) {
      const { cols, rows, targetWidth, targetHeight } = grid;
      const full = draw(bitmap, targetWidth, targetHeight);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          tiles.push(
            full.getImageData(
              c * CONFIG.tileSize,
              r * CONFIG.tileSize,
              CONFIG.tileSize,
              CONFIG.tileSize,
            ),
          );
        }
      }
      if (CONFIG.useThumbnail) {
        tiles.push(
          draw(bitmap, thumb.width, thumb.height).getImageData(0, 0, thumb.width, thumb.height),
        );
      }
    } else {
      tiles.push(
        draw(bitmap, thumb.width, thumb.height).getImageData(0, 0, thumb.width, thumb.height),
      );
    }

    const numTiles = tiles.length;
    const pixelValues = new Float32Array(numTiles * MAX_PATCHES * PATCH_DIM);
    const attentionMask = new BigInt64Array(numTiles * MAX_PATCHES);
    const spatialShapes = new BigInt64Array(numTiles * 2);

    tiles.forEach((tile, i) => {
      const patchesH = Math.floor(tile.height / CONFIG.patchSize);
      const patchesW = Math.floor(tile.width / CONFIG.patchSize);
      if (patchesH * patchesW > MAX_PATCHES) {
        // smartResize et la taille de tuile bornent tous deux à 1024 : si on
        // arrive ici, mieux vaut échouer clairement que déborder en silence.
        throw new Error(`prétraitement : ${patchesH * patchesW} patches > ${MAX_PATCHES}`);
      }
      extractPatches(tile, pixelValues, attentionMask, patchesH, patchesW, i);
      spatialShapes[i * 2] = BigInt(patchesH);
      spatialShapes[i * 2 + 1] = BigInt(patchesW);
    });

    return {
      pixelValues,
      attentionMask,
      spatialShapes,
      numTiles,
      shape: [numTiles, MAX_PATCHES, PATCH_DIM],
      rows: grid?.rows ?? 1,
      cols: grid?.cols ?? 1,
      width: thumb.width,
      height: thumb.height,
    };
  } finally {
    bitmap.close();
  }
}

/** Redimensionne le bitmap sur un canevas hors écran et rend son contexte. */
function draw(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d indisponible');
  // Lissage de qualité : la référence redimensionne en bilinéaire avec
  // anticrénelage (resample: 2, antialias: True). Un échantillonnage brut
  // fabriquerait des artefacts que le modèle décrirait comme du contenu.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx;
}

/**
 * Aplatit chaque patch 16×16 en 768 valeurs normalisées, marque les patches
 * valides à 1 et laisse le reste de la tuile à zéro / masque 0 (padding).
 */
function extractPatches(
  imageData: ImageData,
  pixelValues: Float32Array,
  attentionMask: BigInt64Array,
  patchesH: number,
  patchesW: number,
  tileIndex: number,
): void {
  const { patchSize } = CONFIG;
  const pixels = imageData.data;
  const imageWidth = imageData.width;
  const tileValueOffset = tileIndex * MAX_PATCHES * PATCH_DIM;
  const tileMaskOffset = tileIndex * MAX_PATCHES;

  let patchIdx = 0;
  for (let py = 0; py < patchesH; py++) {
    for (let px = 0; px < patchesW; px++) {
      const startX = px * patchSize;
      const startY = py * patchSize;
      attentionMask[tileMaskOffset + patchIdx] = 1n;

      let out = tileValueOffset + patchIdx * PATCH_DIM;
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
