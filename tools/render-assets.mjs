/**
 * Fabrique les images bitmap que le web social et les systèmes d'exploitation
 * exigent, à partir des sources vectorielles du dépôt.
 *
 *   node tools/render-assets.mjs
 *
 * Pourquoi un script et pas des PNG posés à la main : les sources sont du SVG
 * et du HTML, versionnés et lisibles ; les PNG en sont dérivés et doivent le
 * rester. Sans ce script, retoucher la mascotte laisserait les icônes et la
 * carte sociale en arrière, sans que rien ne le signale.
 *
 * Pourquoi Chrome plutôt qu'une bibliothèque : le projet n'embarque ni sharp ni
 * resvg, et en ajouter une pour quatre images à regénérer une fois par an
 * serait un mauvais échange. Chrome rend déjà du SVG et du HTML avec les mêmes
 * polices que le site.
 *
 * Les PNG produits SONT commités : ni les moissonneurs sociaux ni les systèmes
 * d'exploitation ne rendent de JavaScript, et aucun d'eux n'accepte le SVG de
 * façon fiable.
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
  console.error('Aucun Chrome ni Edge trouvé. Éditez la liste CHROME en tête de ce script.');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '..');

/**
 * Enveloppe un SVG dans une page à la taille EXACTE demandée.
 *
 * Capturer le fichier .svg directement ne marche pas : Chrome l'ouvre comme un
 * document, et un SVG sans attributs `width`/`height` — le nôtre n'a qu'un
 * `viewBox` — est alors dimensionné par ses propres règles, pas par la taille
 * de la fenêtre. Les icônes sortaient en tranche noire décentrée. Ici le SVG
 * est injecté en ligne, forcé aux bonnes dimensions, sur une page sans marge.
 */
function wrapSvg(svgPath, w, h) {
  const svg = readFileSync(join(root, svgPath), 'utf8')
    .replace(/<svg /, `<svg width="${w}" height="${h}" `)
    .replace(/<\?xml[^>]*\?>/, '');
  return `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden}
svg{display:block}</style>${svg}`;
}

/** Une capture = une page, une taille, un fichier de sortie. */
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
  // iOS ne lit ni le manifeste ni le SVG pour l'icône de l'écran d'accueil :
  // il lui faut ce PNG, à cette taille, sous ce nom. Et il applique SON propre
  // masque arrondi — d'où la variante pleine page plutôt que la mascotte aux
  // coins déjà arrondis, qui se serait retrouvée arrondie deux fois.
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
    // La page est écrite DANS le dossier des sources : le gabarit de la carte
    // pourrait référencer un fichier voisin, et une page servie depuis /tmp ne
    // le trouverait pas.
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
