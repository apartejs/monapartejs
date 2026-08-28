/**
 * souffleurs manifest — TS port of souffleur-manifest.js from the lab
 * (HANDOFF-versioning-souffleurs.md). Two pieces:
 *  1. `.data` with VERSIONED names = immutable → never stale, the cache handles it;
 *  2. `manifest.json` (no-store) = source of truth: versions + current paths.
 * Update detection = comparing `version` against the last one seen.
 *
 * App additions: offline fallback (last known-good manifest in localStorage),
 * legacy fallback (unversioned names) until the manifest is on HF,
 * and base purge when `base.rev` changes (the base keeps the same names).
 */
import { SOUFFLEURS_HF_REPO, type AdapterName } from './model-catalog';

const SEEN_KEY = 'bp.souffleurs.seen';
const CACHED_MANIFEST_KEY = 'bp.souffleurs.manifest';
/** "Seen" key for the vision tower (outside the souffleur roles namespace). */
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
 * `vision` block — the detachable tower (ADR-001) and the grafted graph that accepts it.
 * Absent from the manifest = vision not published: the app must degrade gracefully.
 */
export interface ManifestVision {
  version: string;
  /** Graph with the image_features/image_indices inputs. SAME weights as base.weights. */
  graph: string;
  /** Vision tower, immutable versioned name. */
  tower: string;
  tower_data: string;
  /** External data name registered INSIDE the tower graph (to be mapped). */
  tower_internal_data: string;
  size: number;
}

export interface SouffleursManifest {
  schema: string;
  base: { rev: string; graph: string; weights: string; [k: string]: unknown };
  souffleurs: Record<string, ManifestSouffleur>;
  vision?: ManifestVision;
}

/** Legacy manifest (before the first versioned push to HF): historical names. */
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
    /* storage unavailable */
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
   * Network first (no-store), otherwise last known-good manifest, otherwise legacy.
   * Never throws: the 100% local app must be able to start offline.
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

  /** Relative path of the current `.data` (to pass to the worker via externalData). */
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

  /** vision block, or null if the tower isn't published. */
  vision(): ManifestVision | null {
    return this.manifest?.vision ?? null;
  }

  /** Tower weight announced by the manifest (0 if no vision). */
  visionSize(): number {
    return this.manifest?.vision?.size ?? 0;
  }

  /** Absolute URLs of the tower's two files, or null. */
  visionUrls(): { graphUrl: string; dataUrl: string } | null {
    const v = this.manifest?.vision;
    if (!v) return null;
    return { graphUrl: `${this.baseUrl}/${v.tower}`, dataUrl: `${this.baseUrl}/${v.tower_data}` };
  }

  /**
   * true if a tower is published in a version never seen before. Vision is
   * part of the model download (not an option), so this signal must trigger
   * the SAME update flow as the souffleurs — without it, an existing install
   * would never have been offered anything.
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
   * `model_file_name` to pass to transformers.js. The grafted graph is
   * bit-identical to the text graph (measured logits gap: 0), so it's used
   * for EVERYTHING once published: text and vision then only differ by
   * `adapter.data`, exactly like a souffleur swap.
   * Without a vision block, falls back to the historical text graph.
   */
  modelFileName(): string {
    const graph = this.manifest?.vision?.graph;
    if (!graph) return 'model';
    // 'onnx/model_vision_q4.onnx' -> 'model_vision' (tjs re-appends the dtype suffix)
    const base = graph.split('/').pop() ?? '';
    return base.replace(/_q4\.onnx$/, '') || 'model';
  }

  /** true if the current version differs from the last one seen (= update available). */
  hasUpdate(role: string): boolean {
    return this.version(role) !== (this.seen[role] ?? null);
  }

  baseHasUpdate(): boolean {
    return this.seen['__base'] !== undefined && this.seen['__base'] !== this.baseRev();
  }

  updated(): string[] {
    return this.roles().filter((role) => this.hasUpdate(role));
  }

  /** After a successful load: remembers the current version as "seen". */
  markSeen(role?: string): void {
    if (role) this.seen[role] = this.version(role) ?? '';
    else for (const r of this.roles()) this.seen[r] = this.version(r) ?? '';
    this.seen['__base'] = this.baseRev();
    const visionVersion = this.manifest?.vision?.version;
    if (!role && visionVersion) this.seen[VISION_SEEN_KEY] = visionVersion;
    lsSet(SEEN_KEY, JSON.stringify(this.seen));
  }

  /** Integrity (optional) — sha256 of the buffer vs manifest. */
  async verify(role: string, buffer: ArrayBuffer): Promise<boolean> {
    const want = this.sha256(role);
    if (!want) return true;
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const got = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return got === want;
  }
}

/* ── App singleton ─────────────────────────────────────────────────────────── */

let _instance: Promise<SouffleurManifestClient> | null = null;

export function getSouffleurManifest(): Promise<SouffleurManifestClient> {
  if (!_instance) {
    _instance = (async () => {
      const client = new SouffleurManifestClient(
        `https://huggingface.co/${SOUFFLEURS_HF_REPO}/resolve/main`,
      );
      await client.load();
      // base.rev changed (rare): the base files keep the SAME name → the
      // cache must be purged to re-download. The versioned .data files
      // never need this.
      if (client.baseHasUpdate()) {
        try {
          const cache = await caches.open('transformers-cache');
          const keys = await cache.keys();
          await Promise.all(
            keys.filter((req) => req.url.includes('model_q4.onnx')).map((req) => cache.delete(req)),
          );
        } catch {
          /* cache unavailable */
        }
      }
      return client;
    })();
  }
  return _instance;
}

/** Tests only. */
export function resetSouffleurManifestSingleton(): void {
  _instance = null;
}
