/**
 * Image preprocessing for the vision tower — port of `Lfm2VlImageProcessorFast`.
 *
 * Reference ported: the PYTHON implementation of `transformers`
 * (`models/lfm2_vl/image_processing_lfm2_vl.py` + `processing_lfm2_vl.py`),
 * not the transformers.js port. The latter resizes the image to the config's
 * `size` (512×512) BEFORE deciding whether to split it, which makes the
 * "image too large" condition always false: it never splits. The Python one,
 * on the other hand, decides on the ORIGINAL dimensions. Verified by reading
 * both on 08/21.
 *
 * Produces the THREE tensors that `vision-tower` expects:
 *   pixel_values         FLOAT [num_tiles, 1024, 768]
 *   pixel_attention_mask INT64 [num_tiles, 1024]
 *   spatial_shapes       INT64 [num_tiles, 2]
 *
 * A "patch" = 16×16 px flattened into 768 values (16·16·3), normalized
 * (pixel/255 − 0.5)/0.5 = pixel/127.5 − 1.
 *
 * TWO PATHS, like the reference:
 *
 *  - reasonable image -> one tile, simple smart resize;
 *  - too-large image -> grid of 512×512 tiles cut from the image resized to
 *    the closest ratio, PLUS an overall thumbnail in last position. Without
 *    this path, a screenshot or a photographed document was crushed to 256
 *    tokens: fine text disappeared before it even reached the model.
 *
 * Tile ORDER is normative — row by row, thumbnail last. It must exactly
 * match the order of the prompt markers (`<|img_row_R_col_C|>` …
 * `<|img_thumbnail|>`), otherwise the embeds land on the wrong positions and
 * the model describes an image that doesn't exist.
 *
 * Worker-safe: `createImageBitmap` + `OffscreenCanvas` (no `document`).
 */

/** Values from the LFM2.5-VL repo's `processor_config.json` — all verified. */
const CONFIG = {
  patchSize: 16,
  /** 512/16 — a full tile is 32×32 patches, exactly maxPatches. */
  patchesPerTile: 32,
  downsampleFactor: 2,
  minImageTokens: 64,
  maxImageTokens: 256,
  tileSize: 512,
  minTiles: 2,
  maxTiles: 10,
  /** Margin before splitting: an image can exceed by a factor of 2 without being split. */
  maxPixelsTolerance: 2.0,
  useThumbnail: true,
} as const;

/** (pixel/255 − 0.5)/0.5 = pixel/127.5 − 1 — mean/std are 0.5 in the config. */
const NORM_SCALE = 1 / 127.5;
const NORM_OFFSET = -1;

/** 1024: max(maxImageTokens·downsample², (tileSize/patchSize)²) — both equal 1024. */
const MAX_PATCHES = CONFIG.patchesPerTile * CONFIG.patchesPerTile;
const PATCH_DIM = CONFIG.patchSize * CONFIG.patchSize * 3;

export interface PreprocessedImage {
  pixelValues: Float32Array;
  attentionMask: BigInt64Array;
  spatialShapes: BigInt64Array;
  numTiles: number;
  /** [num_tiles, patches_per_tile, patch_dim] */
  shape: [number, number, number];
  /** Split grid. 1×1 = mono-tile path, no thumbnail. */
  rows: number;
  cols: number;
  /**
   * THUMBNAIL dimensions (mono-tile path: those of the single tile). The
   * thumbnail's token count depends on these.
   */
  width: number;
  height: number;
}

const roundByFactor = (n: number, f: number) => Math.round(n / f) * f;
const ceilByFactor = (n: number, f: number) => Math.ceil(n / f) * f;
const floorByFactor = (n: number, f: number) => Math.floor(n / f) * f;

/**
 * Dimensions divisible by patchSize·downsampleFactor (32) and total pixel
 * count bounded in [minPixels, maxPixels] — port of `_smart_resize()`.
 */
export function smartResize(width: number, height: number): { width: number; height: number } {
  const { patchSize, downsampleFactor, minImageTokens, maxImageTokens } = CONFIG;
  const totalFactor = patchSize * downsampleFactor; // 32
  const unit = patchSize ** 2 * downsampleFactor ** 2; // 1024 px per token
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
 * Does the image deserve to be split? Port of `_is_image_too_large()`.
 *
 * On the ORIGINAL dimensions, never on an already-resized image — that's the
 * transformers.js port's bug. Threshold: 256 tokens × 1024 px per token × 2
 * tolerance = 524,288 px, a bit more than 720×720.
 */
export function isImageTooLarge(width: number, height: number): boolean {
  const { patchSize, downsampleFactor, maxImageTokens, maxPixelsTolerance } = CONFIG;
  const totalFactor = patchSize * downsampleFactor;
  const hBar = Math.max(patchSize, roundByFactor(height, totalFactor));
  const wBar = Math.max(patchSize, roundByFactor(width, totalFactor));
  return hBar * wBar > maxImageTokens * totalFactor ** 2 * maxPixelsTolerance;
}

/** All w×h grids whose product fits in [minTiles, maxTiles]. */
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
 * The grid whose aspect ratio best approximates the image's.
 * On a tie, the reference prefers the LARGER grid if the image is big enough
 * to fill it at least halfway — hence the second branch.
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

/** Port of `_get_grid_layout()`. `cols` = grid_width, `rows` = grid_height. */
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
 * Number of tokens produced by an image of these dimensions — port of
 * `_compute_tokens_for_image()`. Holds for both the single tile and the
 * thumbnail.
 */
export function expectedImageTokens(width: number, height: number): number {
  const { patchSize, downsampleFactor } = CONFIG;
  const h = Math.floor(height / patchSize);
  const w = Math.floor(width / patchSize);
  return Math.ceil(h / downsampleFactor) * Math.ceil(w / downsampleFactor);
}

/** Tokens for a full tile — `_compute_tokens_per_tile()`. 512/16/2 squared = 256. */
export const TOKENS_PER_TILE = (() => {
  const patches = CONFIG.tileSize / CONFIG.patchSize;
  return Math.ceil(patches / CONFIG.downsampleFactor) ** 2;
})();

/**
 * Expected total for a preprocessed image: the full tiles plus the
 * thumbnail. Used as a CHECK against the actual count returned by the
 * tower — a mismatch signals a preprocessing divergence, hence an
 * out-of-distribution prompt, which is exactly what we want to see in
 * development.
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

    // One tile per grid cell, plus the overall thumbnail. The reference only
    // adds the thumbnail if the grid isn't 1×1; our bounds (minTiles = 2)
    // already exclude that, but the guard stays aligned with it.
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
        // smartResize and the tile size both bound to 1024: if we get here,
        // it's better to fail clearly than to overflow silently.
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

/** Resizes the bitmap onto an offscreen canvas and returns its context. */
function draw(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d indisponible');
  // Quality smoothing: the reference resizes bilinearly with anti-aliasing
  // (resample: 2, antialias: True). Raw sampling would produce artifacts
  // that the model would describe as content.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx;
}

/**
 * Flattens each 16×16 patch into 768 normalized values, marks valid patches
 * as 1 and leaves the rest of the tile at zero / mask 0 (padding).
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
