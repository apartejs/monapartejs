/**
 * Dynamic favicon — the mark's silhouette as an SVG data-URI, redrawn from
 * text. Zero assets: it follows the state (idle/talking/happy/error) and the
 * theme. At 16 px only a solid shape survives, so the silhouette is the whole
 * drawing and the state is told by its colour (ADR-013).
 */
import { Injectable } from '@angular/core';
import { buildFaviconSvg } from './mark';
import { mascotteText, type MascotteState } from './mascotte-states';

@Injectable({ providedIn: 'root' })
export class FaviconService {
  private link: HTMLLinkElement | null = null;

  set(state: MascotteState = 'idle'): void {
    const dark = document.documentElement.getAttribute('data-aparte-theme') === 'dark';
    const accent = dark ? '#d946ef' : '#a21caf';
    const fill =
      state === 'error'
        ? '#ef4444'
        : state === 'sleeping'
          ? dark
            ? '#4a4356'
            : '#b3aabc'
          : accent;
    const svg = buildFaviconSvg({
      fill,
      // The face is the light: cream on the silhouette in both themes.
      ink: '#f6f2ea',
      background: dark ? '#17141c' : '#f6f2ea',
      face: mascotteText(state),
    });
    const href = `data:image/svg+xml,${encodeURIComponent(svg)}`;

    // The SVG link, not the first `rel=icon` (the .ico for browsers without
    // SVG favicons): that is where the static icons/favicon.svg sits, and
    // redrawing it in place means the tab never shows two different marks.
    if (!this.link) {
      this.link =
        document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]') ??
        document.head.appendChild(
          Object.assign(document.createElement('link'), { rel: 'icon', type: 'image/svg+xml' }),
        );
    }
    this.link.href = href;
  }
}
