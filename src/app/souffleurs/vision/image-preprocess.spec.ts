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

/** Fabrique le strict nécessaire pour expectedTotalTokens. */
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
  it('rend des dimensions divisibles par 32', () => {
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

  it('borne à 256 tokens et remonte à 64 minimum', () => {
    expect(expectedImageTokens(...dims(smartResize(4000, 3000)))).toBeLessThanOrEqual(256);
    expect(expectedImageTokens(...dims(smartResize(16, 16)))).toBeGreaterThanOrEqual(64);
  });
});

describe('isImageTooLarge — le seuil de découpage', () => {
  // 256 tokens x 1024 px par token x 2 de tolérance = 524 288 px.
  it('laisse passer une image raisonnable en une seule tuile', () => {
    expect(isImageTooLarge(512, 512)).toBe(false);
    expect(isImageTooLarge(640, 640)).toBe(false);
    expect(isImageTooLarge(128, 128)).toBe(false);
  });

  it('découpe ce qui dépasse le seuil', () => {
    expect(isImageTooLarge(1920, 1080)).toBe(true);
    expect(isImageTooLarge(2000, 2000)).toBe(true);
  });

  it("décide sur les dimensions D'ORIGINE, pas sur une image déjà réduite", () => {
    // Le portage transformers.js redimensionne à 512x512 avant de décider, ce
    // qui rend la condition toujours fausse. Le Python — et nous — décidons
    // avant toute réduction. Ce test verrouille la différence.
    expect(isImageTooLarge(1920, 1080)).toBe(true);
    const reduced = smartResize(1920, 1080);
    expect(isImageTooLarge(reduced.width, reduced.height)).toBe(false);
  });
});

describe('gridLayout', () => {
  it('choisit une grille au rapport proche et bornée à 10 tuiles', () => {
    const wide = gridLayout(1920, 1080);
    expect(wide.cols * wide.rows).toBeLessThanOrEqual(10);
    expect(wide.cols).toBeGreaterThanOrEqual(wide.rows);
    expect(wide.targetWidth).toBe(512 * wide.cols);
    expect(wide.targetHeight).toBe(512 * wide.rows);
  });

  it('préfère la grille la plus grande à rapport égal quand l’image la remplit', () => {
    // Carré : 2x2 et 3x3 ont le même rapport ; la référence garde 3x3 dès que
    // l'aire dépasse la moitié de la surface de la grille.
    expect(gridLayout(2000, 2000)).toMatchObject({ cols: 3, rows: 3 });
  });

  it('ne descend jamais sous 2 tuiles — 1x1 est exclu des rapports', () => {
    const g = gridLayout(2000, 2000);
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(2);
  });
});

describe('comptage des tokens', () => {
  it('une tuile pleine vaut 256 tokens', () => {
    expect(TOKENS_PER_TILE).toBe(256);
  });

  it('mono-tuile : le total est celui de la seule image', () => {
    const img = processed({ numTiles: 1, rows: 1, cols: 1, width: 256, height: 256 });
    expect(expectedTotalTokens(img)).toBe(expectedImageTokens(256, 256));
    expect(expectedTotalTokens(img)).toBe(64);
  });

  it('multi-tuiles : les tuiles PLUS la vignette', () => {
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

  it('le découpage apporte bien plus de tokens que la réduction seule', () => {
    // C'est TOUT l'intérêt du chemin haute résolution : sans lui, une capture
    // d'écran 1920x1080 était écrasée à ~250 tokens et le texte fin
    // disparaissait avant d'atteindre le modèle.
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
