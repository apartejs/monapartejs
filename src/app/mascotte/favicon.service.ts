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

    // NO house here. At 16-32 px the walls and the face fight for the same few
    // pixels and neither wins — tried, and unreadable in the tab. The favicon
    // keeps the bare face, big, and says the state through its colour.
    const ink =
      state === 'error'
        ? '#ef4444'
        : state === 'sleeping'
          ? dark
            ? '#4a4356'
            : '#b3aabc'
          : accent;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
      `<rect width="64" height="64" rx="14" fill="${bg}"/>` +
      `<text x="32" y="41" font-family="Georgia, serif" font-size="24" text-anchor="middle" fill="${ink}">${face}</text>` +
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
