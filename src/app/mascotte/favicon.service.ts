/**
 * Dynamic favicon — the mascot as an SVG data-URI, generated from text.
 * Zero assets: the favicon follows the state (idle/talking/error) and the theme.
 */
import { Injectable } from '@angular/core';
import { mascotteText, type MascotteState } from './mascotte-states';

@Injectable({ providedIn: 'root' })
export class FaviconService {
  private link: HTMLLinkElement | null = null;

  set(state: MascotteState = 'idle'): void {
    const dark = document.documentElement.getAttribute('data-aparte-theme') === 'dark';
    const accent = dark ? '#d946ef' : '#a21caf';
    const bg = dark ? '#17141c' : '#f6f2ea';
    const face = mascotteText(state);

    // At 32 px the face is barely a smudge, so the HOUSE carries the state:
    // its stroke says what is happening (accent / red / grey) and the light
    // inside says how hard it is working. The face still changes, for whoever
    // looks at the tab at full size.
    const stroke =
      state === 'error'
        ? '#ef4444'
        : state === 'sleeping'
          ? dark
            ? '#4a4356'
            : '#b3aabc'
          : accent;
    const glow = state === 'talking' ? 0.26 : state === 'thinking' ? 0.15 : 0;
    // Same silhouette as the component and the icons, scaled to 64 and centred.
    const house = 'M9 50 L9 26 L32 14 L55 26 L55 50 Z';

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
      (glow ? `<path d="${house}" fill="${accent}" opacity="${glow}"/>` : '') +
      `<path d="${house}" fill="none" stroke="${stroke}" stroke-width="2.6" stroke-linejoin="round"/>` +
      `<text x="32" y="43" font-family="Georgia, serif" font-size="16" text-anchor="middle" fill="${stroke}">${face}</text>` +
      `</svg>`;
    const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;

    if (!this.link) {
      this.link =
        document.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
        document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
    }
    this.link.type = 'image/svg+xml';
    this.link.href = href;
  }
}
