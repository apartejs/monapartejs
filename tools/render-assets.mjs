/**
 * Produces the bitmap images that the social web and operating systems
 * require, from the repo's vector sources.
 *
 *   node tools/render-assets.mjs
 *
 * Why a script and not hand-placed PNGs: the sources are SVG and HTML,
 * versioned and readable; the PNGs are derived from them and must stay that
 * way. Without this script, touching up the mascot would leave the icons
 * and the social card behind, with nothing to flag it.
 *
 * Why Chrome rather than a library: the project bundles neither sharp nor
 * resvg, and adding one for four images to regenerate once a year would be
 * a bad trade. Chrome already renders SVG and HTML with the same fonts as
 * the site.
 *
 * The produced PNGs ARE committed: neither social crawlers nor operating
 * systems render JavaScript, and none of them reliably accepts SVG.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('No Chrome or Edge found. Edit the CHROME list at the top of this script.');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');

/**
 * Wraps an SVG in a page at the EXACT requested size.
 *
 * Capturing the .svg file directly doesn't work: Chrome opens it as a
 * document, and an SVG without `width`/`height` attributes — ours only has
 * a `viewBox` — is then sized by its own rules, not by the window size.
 * The icons came out as an off-center black slice. Here the SVG is inlined,
 * forced to the right dimensions, on a page with no margin.
 */
function wrapSvg(svgPath, w, h) {
  const svg = readFileSync(join(root, svgPath), 'utf8')
    .replace(/<svg /, `<svg width="${w}" height="${h}" `)
    .replace(/<\?xml[^>]*\?>/, '');
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden}
svg{display:block}</style>${svg}`;
}

/** One capture = one page, one size, one output file. */
const JOBS = [
  {
    page: () => readFileSync(join(root, 'tools/og-card.html'), 'utf8'),
    out: 'public/og-card.png',
    w: 1200,
    h: 630,
  },
  {
    page: (w, h) => wrapSvg('public/icons/mascotte.svg', w, h),
    out: 'public/icons/icon-192.png',
    w: 192,
    h: 192,
  },
  {
    page: (w, h) => wrapSvg('public/icons/mascotte.svg', w, h),
    out: 'public/icons/icon-512.png',
    w: 512,
    h: 512,
  },
  {
    page: (w, h) => wrapSvg('public/icons/mascotte-maskable.svg', w, h),
    out: 'public/icons/icon-512-maskable.png',
    w: 512,
    h: 512,
  },
  // iOS reads neither the manifest nor the SVG for the home-screen icon:
  // it needs this PNG, at this size, under this name. And it applies ITS
  // OWN rounded mask — hence the full-bleed variant rather than the mascot
  // with already-rounded corners, which would have ended up rounded twice.
  {
    page: (w, h) => wrapSvg('public/icons/mascotte-maskable.svg', w, h),
    out: 'public/apple-touch-icon.png',
    w: 180,
    h: 180,
  },
];

for (const job of JOBS) {
  const dir = mkdtempSync(join(tmpdir(), 'monaparte-render-'));
  try {
    // The page is written INTO the source folder: the card template might
    // reference a neighboring file, and a page served from /tmp wouldn't
    // find it.
    const pagePath = join(root, 'tools', `.render-${Date.now()}.html`);
    writeFileSync(pagePath, job.page(job.w, job.h), 'utf8');
    try {
      execFileSync(
        CHROME,
        [
          '--headless',
          '--disable-gpu',
          `--screenshot=${join(dir, 'shot.png')}`,
          `--window-size=${job.w},${job.h}`,
          '--hide-scrollbars',
          '--force-device-scale-factor=1',
          pathToFileURL(pagePath).href,
        ],
        { stdio: 'pipe' },
      );
      copyFileSync(join(dir, 'shot.png'), join(root, job.out));
      console.log(`${job.out}  ${job.w}x${job.h}`);
    } finally {
      rmSync(pagePath, { force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
