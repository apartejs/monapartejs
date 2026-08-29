/**
 * Produces the bitmap images that the social web and operating systems
 * require, from the repo's vector sources.
 *
 *   node tools/render-assets.mjs
 *
 * Why a script and not hand-placed PNGs: the sources are SVG and HTML,
 * versioned and readable; the PNGs are derived from them and must stay that
 * way. Without this script, touching up the mascot would leave the icons,
 * the favicon and the social card behind, with nothing to flag it.
 *
 * Why Chrome rather than a library: the project bundles neither sharp nor
 * resvg, and adding one for six images to regenerate once a year would be
 * a bad trade. Chrome already renders SVG and HTML with the same fonts as
 * the site.
 *
 * The produced PNGs and the .ico ARE committed: neither social crawlers nor
 * operating systems render JavaScript, and none of them reliably accepts SVG.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
<style>html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}
svg{display:block}</style>${svg}`;
}

/**
 * One capture = one page, one size, one PNG (as a Buffer).
 *
 * The page is written INTO the source folder: the card template might
 * reference a neighboring file, and a page served from /tmp wouldn't find it.
 * `--default-background-color=00000000` keeps the corners of the rounded
 * icons transparent instead of white.
 */
function capture(html, w, h) {
  const dir = mkdtempSync(join(tmpdir(), 'monaparte-render-'));
  const pagePath = join(root, 'tools', `.render-${Date.now()}-${w}.html`);
  try {
    writeFileSync(pagePath, html, 'utf8');
    const shot = join(dir, 'shot.png');
    execFileSync(
      CHROME,
      [
        '--headless',
        '--disable-gpu',
        '--default-background-color=00000000',
        `--screenshot=${shot}`,
        `--window-size=${w},${h}`,
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        pathToFileURL(pagePath).href,
      ],
      { stdio: 'pipe' },
    );
    return readFileSync(shot);
  } finally {
    rmSync(pagePath, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Packs PNGs into an .ico. The container is trivial — a 6-byte header, one
 * 16-byte entry per image, then the PNG data as is: every browser and
 * Windows since Vista read PNG-compressed entries.
 */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, data }, i) => {
    const at = i * 16;
    entries[at] = size === 256 ? 0 : size; // width, 0 meaning 256
    entries[at + 1] = size === 256 ? 0 : size; // height
    entries[at + 2] = 0; // palette
    entries[at + 3] = 0; // reserved
    entries.writeUInt16LE(1, at + 4); // colour planes
    entries.writeUInt16LE(32, at + 6); // bits per pixel
    entries.writeUInt32LE(data.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, entries, ...images.map((i) => i.data)]);
}

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
  writeFileSync(join(root, job.out), capture(job.page(job.w, job.h), job.w, job.h));
  console.log(`${job.out}  ${job.w}x${job.h}`);
}

// The .ico, for browsers without SVG favicons: the same silhouette as
// icons/favicon.svg, rasterised at the three sizes a tab or a shortcut asks for.
const ICO_SIZES = [16, 32, 48];
writeFileSync(
  join(root, 'public/favicon.ico'),
  packIco(
    ICO_SIZES.map((size) => ({
      size,
      data: capture(wrapSvg('public/icons/favicon.svg', size, size), size, size),
    })),
  ),
);
console.log(`public/favicon.ico  ${ICO_SIZES.join('/')}`);
