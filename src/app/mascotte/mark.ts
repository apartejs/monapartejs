/**
 * The mark's geometry, written once (ADR-013). The component, the favicon and
 * the icon SVGs all draw this same path, and `mark.spec.ts` checks that they do:
 * the day the drawing lived in four files, it drifted into four drawings.
 *
 * A 120×100 box. A house — closed, no door, no window — whose floor carries
 * the tail of a speech bubble, on the LEFT: the side the assistant speaks
 * from. The walls span x 8..112, the eaves sit at y 34, the floor at y 84, the
 * roof's apex at (60, 4) and the tail's tip at (30, 100).
 */
export const MARK_PATH = 'M60 4 L112 34 L112 84 L48 84 L30 100 L30 84 L8 84 L8 34 Z';

/** The tail alone. It lights up while the mascot talks: the words leave the house through it. */
export const MARK_TAIL_PATH = 'M48 84 L30 100 L30 84 Z';

export const MARK_BOX = { width: 120, height: 100 } as const;

/**
 * The face's font size, in box units. The walls leave 100 units clear between
 * their strokes; the widest faces — `(ˆ.ˆ)` and `(x.x)`, 2.23 em in Georgia
 * (see mascotte-states.ts for the glyphs) — must sit inside with a margin, and
 * the idle `('.')` must still fill the house: 40 gives 89 units for the widest
 * and 66 for the idle. At 44 the parentheses of a happy face ran into the walls.
 */
export const MARK_FACE_SIZE = 40;

/**
 * The face's baseline, in box units: the walls' centre (y 59) plus 0.295 em —
 * Georgia's parentheses rise 0.75 em above the baseline and hang 0.16 below,
 * so their centre is 0.295 em above it.
 */
export const MARK_FACE_BASELINE = 71;

/** The walls' centre, in em of the face — where the face's visual centre must sit. */
export const MARK_FACE_CENTRE_EM = 59 / MARK_FACE_SIZE;

export const MARK_FONT = "Georgia, 'Times New Roman', serif";

export interface FaviconSvgOptions {
  /** The silhouette's colour — the state. */
  fill: string;
  /** The face's colour. */
  ink: string;
  /** Behind the rounded square. */
  background: string;
  /** The face, as text: `('.')`. */
  face: string;
}

/**
 * The favicon: the silhouette, solid. At 16 px an outline turns to mush and the
 * bare face to a speck; a solid shape is the one drawing that survives, and it
 * says the state through its colour. Pure, so a test can read it without a DOM.
 */
export function buildFaviconSvg({ fill, ink, background, face }: FaviconSvgOptions): string {
  const scale = 56 / MARK_BOX.width;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${background}"/>` +
    `<g transform="translate(4 2) scale(${scale.toFixed(4)})">` +
    `<path d="${MARK_PATH}" fill="${fill}"/>` +
    `<text x="${MARK_BOX.width / 2}" y="${MARK_FACE_BASELINE}" font-family="${MARK_FONT}" ` +
    `font-size="${MARK_FACE_SIZE}" text-anchor="middle" fill="${ink}">${face}</text>` +
    `</g></svg>`
  );
}
