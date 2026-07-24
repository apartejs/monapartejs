/**
 * Versioning des poids téléchargés (équivalent des markers aimi) : après un
 * préchargement réussi on écrit la version courante ; au boot, si le modèle est
 * en cache mais que la version stockée diffère du catalogue → consentement de
 * re-téléchargement (modal), jamais de re-download silencieux.
 */
import { ADAPTER_VERSIONS, CALLER_ADAPTER } from './model-catalog';

const STORE_KEY = 'bp.model.versions';

type VersionMap = Partial<Record<string, string>>;

function readVersions(): VersionMap {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as VersionMap;
  } catch {
    return {};
  }
}

function writeVersions(map: VersionMap): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* stockage indisponible */
  }
}

/** À appeler après un prepareModel réussi. */
export function markAdapterPreloaded(adapter: string = CALLER_ADAPTER): void {
  const map = readVersions();
  map[adapter] = ADAPTER_VERSIONS[adapter as keyof typeof ADAPTER_VERSIONS];
  writeVersions(map);
}

/** Vrai si les poids en cache correspondent à une version dépassée (ou inconnue). */
export function isAdapterStale(adapter: string = CALLER_ADAPTER): boolean {
  return readVersions()[adapter] !== ADAPTER_VERSIONS[adapter as keyof typeof ADAPTER_VERSIONS];
}

export function clearVersionMarkers(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* stockage indisponible */
  }
}
