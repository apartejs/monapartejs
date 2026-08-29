import { describe, expect, it } from 'vitest';
import { cornerMascotteSize } from './corner-mascotte';

describe('the corner mascot and its gutter', () => {
  it('is full size when the gutter is wide', () => {
    expect(cornerMascotteSize(1920, true)).toBe(56);
    expect(cornerMascotteSize(1280, false)).toBe(56);
  });

  it('shrinks on a laptop with the sidebar open, rather than disappearing', () => {
    expect(cornerMascotteSize(1440, true)).toBe(40);
    expect(cornerMascotteSize(1366, true)).toBe(40);
    expect(cornerMascotteSize(1100, false)).toBe(40);
  });

  it('hides when it would sit over the column — the sidebar counts', () => {
    // 1280 wide, sidebar open: 1012 px of main area, 114 px of gutter.
    expect(cornerMascotteSize(1280, true)).toBe(0);
    expect(cornerMascotteSize(1000, false)).toBe(0);
  });

  it('under 768 the sidebar is an overlay, and there is no gutter anyway', () => {
    expect(cornerMascotteSize(700, true)).toBe(0);
    expect(cornerMascotteSize(700, false)).toBe(0);
  });
});
