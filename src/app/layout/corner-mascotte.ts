/**
 * Whether the corner mascot has a gutter to live in, and how big it may be.
 *
 * The chat column is centred in the main area, to the right of the sidebar;
 * the mascot sits in the gutter to the right of that column. A media query on
 * the viewport could not know about the sidebar: between 1100 and 1300 px with
 * the sidebar open, the house sat over the column and slid behind the composer
 * while the window was resized. The rule has to read the main area, not the
 * viewport — and it is pure, so it can be tested with numbers.
 */

/** `--bp-sidebar-width`; a column of the shell's grid, 0 when closed. */
export const SIDEBAR_WIDTH = 268;
/** Below this the sidebar is an overlay, not a column (app.component.scss). */
export const SIDEBAR_OVERLAY_BELOW = 768;
/** `--bp-content-max-width` plus the chat page's horizontal padding. */
export const COLUMN_WIDTH = 760 + 24;
/** `.corner-mascotte` — `right`, and the room to keep from the column. */
export const CORNER_RIGHT = 22;
export const CORNER_GAP = 12;
/** The house is three times the face (mark.ts). */
const HOUSE_PER_FACE = 3;

/** Face sizes, largest first: the first that fits wins. */
const TIERS = [56, 40] as const;

/** The face size the gutter allows, or 0 when it allows none. */
export function cornerMascotteSize(viewportWidth: number, sidebarOpen: boolean): number {
  const sidebar = sidebarOpen && viewportWidth > SIDEBAR_OVERLAY_BELOW ? SIDEBAR_WIDTH : 0;
  const gutter = (viewportWidth - sidebar - COLUMN_WIDTH) / 2;
  return TIERS.find((face) => gutter >= face * HOUSE_PER_FACE + CORNER_RIGHT + CORNER_GAP) ?? 0;
}
