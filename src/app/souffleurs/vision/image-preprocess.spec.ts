import { describe, expect, it } from 'vitest';
import {
  TOKENS_PER_TILE,
  expectedImageTokens,
  expectedTotalTokens,
  gridLayout,
  isImageTooLarge,
  smartResize,
  type PreprocessedImage,
} from './image-preprocess';

/** Builds the strict minimum needed for expectedTotalTokens. */
function processed(part: Partial<PreprocessedImage>): PreprocessedImage {
  return {
    pixelValues: new Float32Array(0),
    attentionMask: new BigInt64Array(0),
    spatialShapes: new BigInt64Array(0),
    numTiles: 1,
    shape: [1, 1024, 768],
    rows: 1,
    cols: 1,
    width: 512,
    height: 512,
    ...part,
  };
}

describe('smartResize', () => {
  it('returns dimensions divisible by 32', () => {
    for (const [w, h] of [
      [1920, 1080],
      [128, 128],
      [37, 913],
      [4000, 3000],
    ]) {
      const out = smartResize(w, h);
      expect(out.width % 32).toBe(0);
      expect(out.height % 32).toBe(0);
    }
  });

  it('bounds at 256 tokens and floors up to 64 minimum', () => {
    expect(expectedImageTokens(...dims(smartResize(4000, 3000)))).toBeLessThanOrEqual(256);
    expect(expectedImageTokens(...dims(smartResize(16, 16)))).toBeGreaterThanOrEqual(64);
  });
});

describe('isImageTooLarge — the split threshold', () => {
  // 256 tokens x 1024 px per token x 2 tolerance = 524,288 px.
  it('lets a reasonable image through as a single tile', () => {
    expect(isImageTooLarge(512, 512)).toBe(false);
    expect(isImageTooLarge(640, 640)).toBe(false);
    expect(isImageTooLarge(128, 128)).toBe(false);
  });

  it('splits what exceeds the threshold', () => {
    expect(isImageTooLarge(1920, 1080)).toBe(true);
    expect(isImageTooLarge(2000, 2000)).toBe(true);
  });

  it('decides on the ORIGINAL dimensions, not on an already-reduced image', () => {
    // The transformers.js port resizes to 512x512 before deciding, which
    // makes the condition always false. Python — and us — decide before any
    // reduction. This test locks in the difference.
    expect(isImageTooLarge(1920, 1080)).toBe(true);
    const reduced = smartResize(1920, 1080);
    expect(isImageTooLarge(reduced.width, reduced.height)).toBe(false);
  });
});

describe('gridLayout', () => {
  it('picks a grid with a close ratio, bounded to 10 tiles', () => {
    const wide = gridLayout(1920, 1080);
    expect(wide.cols * wide.rows).toBeLessThanOrEqual(10);
    expect(wide.cols).toBeGreaterThanOrEqual(wide.rows);
    expect(wide.targetWidth).toBe(512 * wide.cols);
    expect(wide.targetHeight).toBe(512 * wide.rows);
  });

  it('prefers the larger grid on a ratio tie when the image fills it', () => {
    // Square: 2x2 and 3x3 have the same ratio; the reference keeps 3x3 as
    // soon as the area exceeds half the grid's surface.
    expect(gridLayout(2000, 2000)).toMatchObject({ cols: 3, rows: 3 });
  });

  it('never goes below 2 tiles — 1x1 is excluded from the ratios', () => {
    const g = gridLayout(2000, 2000);
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(2);
  });
});

describe('token counting', () => {
  it('a full tile is worth 256 tokens', () => {
    expect(TOKENS_PER_TILE).toBe(256);
  });

  it('mono-tile: the total is that of the single image', () => {
    const img = processed({ numTiles: 1, rows: 1, cols: 1, width: 256, height: 256 });
    expect(expectedTotalTokens(img)).toBe(expectedImageTokens(256, 256));
    expect(expectedTotalTokens(img)).toBe(64);
  });

  it('multi-tile: the tiles PLUS the thumbnail', () => {
    const thumb = smartResize(1920, 1080);
    const img = processed({
      numTiles: 3,
      rows: 1,
      cols: 2,
      width: thumb.width,
      height: thumb.height,
    });
    expect(expectedTotalTokens(img)).toBe(
      2 * TOKENS_PER_TILE + expectedImageTokens(thumb.width, thumb.height),
    );
  });

  it('splitting brings far more tokens than reduction alone', () => {
    // This is the WHOLE point of the high-resolution path: without it, a
    // 1920x1080 screenshot was crushed to ~250 tokens and fine text
    // disappeared before reaching the model.
    const thumb = smartResize(1920, 1080);
    const seul = expectedImageTokens(thumb.width, thumb.height);
    const grid = gridLayout(1920, 1080);
    const decoupe = expectedTotalTokens(
      processed({
        numTiles: grid.cols * grid.rows + 1,
        rows: grid.rows,
        cols: grid.cols,
        width: thumb.width,
        height: thumb.height,
      }),
    );
    expect(decoupe).toBeGreaterThan(seul * 2);
  });
});

function dims(s: { width: number; height: number }): [number, number] {
  return [s.width, s.height];
}
