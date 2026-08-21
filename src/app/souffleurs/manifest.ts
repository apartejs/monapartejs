/**
 * Manifest des souffleurs — port TS de souffleur-manifest.js du lab
 * (HANDOFF-versioning-souffleurs.md). Deux pièces :
 *  1. `.data` à noms VERSIONNÉS = immuables → jamais de stale, le cache gère ;
 *  2. `manifest.json` (no-store) = point de vérité : versions + chemins courants.
 * Détection de mise à jour = comparaison de `version` avec la dernière vue.
 *
 * Ajouts app : fallback hors-ligne (dernier manifest bon connu en localStorage),
 * fallback legacy (noms non versionnés) tant que le manifest n'est pas sur HF,
 * et purge du base quand `base.rev` change (le base garde les mêmes noms).
 */
import { SOUFFLEURS_HF_REPO, type AdapterName } from './model-catalog';

const SEEN_KEY = 'bp.souffleurs.seen';
const CACHED_MANIFEST_KEY = 'bp.souffleurs.manifest';
/** Clé « vue » de la tour vision (hors de l'espace des rôles souffleurs). */
const VISION_SEEN_KEY = '__vision';

export type SouffleurRole = 'chat' | 'pdf' | 'xlsx-docx' | 'sandbox';

export const adapterRole = (adapter: AdapterName): SouffleurRole =>
  adapter.replace(/^souffleur-/, '') as SouffleurRole;

interface ManifestSouffleur {
  version: string;
  file: string;
  size?: number;
  sha256?: string;
}

/**
 * Bloc `vision` — la tour détachable (ADR-001) et le graphe greffé qui l'accepte.
 * Absent du manifest = vision non publiée : l'app doit dégrader proprement.
 */
export interface ManifestVision {
  version: string;
  /** Graphe avec les entrées image_features/image_indices. MÊMES poids que base.weights. */
  graph: string;
  /** Tour vision, nom versionné immuable. */
  tower: string;
  tower_data: string;
  /** Nom d'external data inscrit DANS le graphe de la tour (à mapper). */
  tower_internal_data: string;
  size: number;
}

export interface SouffleursManifest {
  schema: string;
  base: { rev: string; graph: string; weights: string; [k: string]: unknown };
  souffleurs: Record<string, ManifestSouffleur>;
  vision?: ManifestVision;
}

/** Manifest legacy (avant le premier push versionné sur HF) : noms historiques. */
const LEGACY_MANIFEST: SouffleursManifest = {
  schema: 'aparte-souffleurs/legacy',
  base: { rev: 'legacy', graph: 'onnx/model_q4.onnx', weights: 'onnx/model_q4.onnx_data' },
  souffleurs: Object.fromEntries(
    (['chat', 'pdf', 'xlsx-docx', 'sandbox'] as const).map((role) => [
      role,
      { version: 'legacy', file: `adapters/souffleur-${role}.data` },
    ]),
  ),
};

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

export class SouffleurManifestClient {
  readonly baseUrl: string;
  manifest: SouffleursManifest | null = null;
  private seen: Record<string, string>;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    try {
      this.seen = JSON.parse(lsGet(SEEN_KEY) ?? '{}') as Record<string, string>;
    } catch {
      this.seen = {};
    }
  }

  /**
   * Réseau d'abord (no-store), sinon dernier manifest bon connu, sinon legacy.
   * Ne throw jamais : l'app 100 % locale doit démarrer hors-ligne.
   */
  async load(): Promise<SouffleursManifest> {
    try {
      const res = await fetch(`${this.baseUrl}/manifest.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      this.manifest = (await res.json()) as SouffleursManifest;
      lsSet(CACHED_MANIFEST_KEY, JSON.stringify(this.manifest));
    } catch {
      const cached = lsGet(CACHED_MANIFEST_KEY);
      if (cached) {
        try {
          this.manifest = JSON.parse(cached) as SouffleursManifest;
        } catch {
          this.manifest = LEGACY_MANIFEST;
        }
      } else {
        this.manifest = LEGACY_MANIFEST;
      }
    }
    return this.manifest;
  }

  roles(): string[] {
    return Object.keys(this.manifest?.souffleurs ?? {});
  }

  version(role: string): string | null {
    return this.manifest?.souffleurs?.[role]?.version ?? null;
  }

  size(role: string): number | null {
    return this.manifest?.souffleurs?.[role]?.size ?? null;
  }

  sha256(role: string): string | null {
    return this.manifest?.souffleurs?.[role]?.sha256 ?? null;
  }

  /** Chemin relatif du `.data` courant (à passer au worker via externalData). */
  file(role: string): string {
    const entry = this.manifest?.souffleurs?.[role];
    if (!entry) throw new Error(`souffleur inconnu: ${role}`);
    return entry.file;
  }

  baseWeightsFile(): string {
    return this.manifest?.base?.weights ?? 'onnx/model_q4.onnx_data';
  }

  baseRev(): string {
    return this.manifest?.base?.rev ?? 'legacy';
  }

  /** Bloc vision, ou null si la tour n'est pas publiée. */
  vision(): ManifestVision | null {
    return this.manifest?.vision ?? null;
  }

  /** Poids de la tour annoncé par le manifest (0 si pas de vision). */
  visionSize(): number {
    return this.manifest?.vision?.size ?? 0;
  }

  /** URLs absolues des deux fichiers de la tour, ou null. */
  visionUrls(): { graphUrl: string; dataUrl: string } | null {
    const v = this.manifest?.vision;
    if (!v) return null;
    return { graphUrl: `${this.baseUrl}/${v.tower}`, dataUrl: `${this.baseUrl}/${v.tower_data}` };
  }

  /**
   * true si une tour est publiée dans une version jamais vue. La vision fait
   * partie du téléchargement du modèle (pas une option), donc ce signal doit
   * déclencher le MÊME flux de mise à jour que les souffleurs — sans lui, une
   * install existante n'aurait jamais rien proposé.
   */
  visionHasUpdate(): boolean {
    const version = this.manifest?.vision?.version;
    return !!version && this.seen[VISION_SEEN_KEY] !== version;
  }

  markSeenVision(): void {
    const version = this.manifest?.vision?.version;
    if (!version) return;
    this.seen[VISION_SEEN_KEY] = version;
    lsSet(SEEN_KEY, JSON.stringify(this.seen));
  }

  /**
   * `model_file_name` à passer à transformers.js. Le graphe greffé est
   * bit-identique au graphe texte (écart de logits mesuré : 0), donc on
   * l'utilise pour TOUT dès qu'il est publié : texte et vision ne diffèrent
   * plus que par `adapter.data`, exactement comme un swap de souffleur.
   * Sans bloc vision, on retombe sur le graphe texte historique.
   */
  modelFileName(): string {
    const graph = this.manifest?.vision?.graph;
    if (!graph) return 'model';
    // 'onnx/model_vision_q4.onnx' -> 'model_vision' (tjs recolle le suffixe dtype)
    const base = graph.split('/').pop() ?? '';
    return base.replace(/_q4\.onnx$/, '') || 'model';
  }

  /** true si la version courante diffère de la dernière vue (= MAJ dispo). */
  hasUpdate(role: string): boolean {
    return this.version(role) !== (this.seen[role] ?? null);
  }

  baseHasUpdate(): boolean {
    return this.seen['__base'] !== undefined && this.seen['__base'] !== this.baseRev();
  }

  updated(): string[] {
    return this.roles().filter((role) => this.hasUpdate(role));
  }

  /** Après un chargement réussi : mémorise la version courante comme « vue ». */
  markSeen(role?: string): void {
    if (role) this.seen[role] = this.version(role) ?? '';
    else for (const r of this.roles()) this.seen[r] = this.version(r) ?? '';
    this.seen['__base'] = this.baseRev();
    const visionVersion = this.manifest?.vision?.version;
    if (!role && visionVersion) this.seen[VISION_SEEN_KEY] = visionVersion;
    lsSet(SEEN_KEY, JSON.stringify(this.seen));
  }

  /** Intégrité (optionnel) — sha256 du buffer vs manifest. */
  async verify(role: string, buffer: ArrayBuffer): Promise<boolean> {
    const want = this.sha256(role);
    if (!want) return true;
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const got = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return got === want;
  }
}

/* ── Singleton app ─────────────────────────────────────────────────────────── */

let _instance: Promise<SouffleurManifestClient> | null = null;

export function getSouffleurManifest(): Promise<SouffleurManifestClient> {
  if (!_instance) {
    _instance = (async () => {
      const client = new SouffleurManifestClient(
        `https://huggingface.co/${SOUFFLEURS_HF_REPO}/resolve/main`,
      );
      await client.load();
      // base.rev a changé (rare) : les fichiers base gardent le MÊME nom → il
      // faut purger le cache pour re-télécharger. Les .data versionnés, eux,
      // n'en ont jamais besoin.
      if (client.baseHasUpdate()) {
        try {
          const cache = await caches.open('transformers-cache');
          const keys = await cache.keys();
          await Promise.all(
            keys
              .filter((req) => req.url.includes('model_q4.onnx'))
              .map((req) => cache.delete(req)),
          );
        } catch {
          /* cache indisponible */
        }
      }
      return client;
    })();
  }
  return _instance;
}

/** Tests uniquement. */
export function resetSouffleurManifestSingleton(): void {
  _instance = null;
}
