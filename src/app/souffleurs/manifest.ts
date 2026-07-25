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

export type SouffleurRole = 'chat' | 'pdf' | 'xlsx-docx' | 'sandbox';

export const adapterRole = (adapter: AdapterName): SouffleurRole =>
  adapter.replace(/^souffleur-/, '') as SouffleurRole;

interface ManifestSouffleur {
  version: string;
  file: string;
  size?: number;
  sha256?: string;
}

export interface SouffleursManifest {
  schema: string;
  base: { rev: string; graph: string; weights: string; [k: string]: unknown };
  souffleurs: Record<string, ManifestSouffleur>;
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
