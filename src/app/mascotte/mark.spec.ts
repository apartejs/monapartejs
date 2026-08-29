/**
 * The mark is drawn in several files that no compiler links together: two
 * launcher icons, the static favicon, the social card. This guards them
 * against drifting away from the geometry the component draws.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARK_PATH, buildFaviconSvg } from './mark';

const DRAWINGS = [
  'public/icons/mascotte.svg',
  'public/icons/mascotte-maskable.svg',
  'public/icons/favicon.svg',
  'tools/og-card.html',
];

describe('the mark', () => {
  it.each(DRAWINGS)('%s draws the same house as the component', (file) => {
    expect(readFileSync(file, 'utf8')).toContain(`d="${MARK_PATH}"`);
  });

  it('the dynamic favicon draws it too, solid, with the face inside', () => {
    const svg = buildFaviconSvg({
      fill: '#a21caf',
      ink: '#f6f2ea',
      background: '#f6f2ea',
      face: "('.')",
    });
    expect(svg).toContain(`<path d="${MARK_PATH}" fill="#a21caf"/>`);
    expect(svg).toContain(`>('.')</text>`);
  });
});
