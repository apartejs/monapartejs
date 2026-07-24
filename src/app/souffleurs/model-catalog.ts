/** Catalogue des souffleurs — repo HF, adapters, tailles (pour la progression pondérée). */

export const SOUFFLEURS_HF_REPO = 'maxituc/aparte-souffleurs';

export type AdapterName =
  | 'souffleur-chat'
  | 'souffleur-pdf'
  | 'souffleur-xlsx-docx'
  | 'souffleur-sandbox';

export const CALLER_ADAPTER: AdapterName = 'souffleur-chat';

/** Id du modèle visible côté aparté (sélecteur, model config). */
export const CALLER_MODEL_ID = 'souffleur-chat';

export const BASE_WEIGHTS_FILE = 'onnx/model_q4.onnx_data';
export const adapterDataFile = (adapter: AdapterName): string => `adapters/${adapter}.data`;

/** Tailles approximatives (progression + textes d'onboarding générés, jamais codées en dur ailleurs). */
export const SIZE_BASE_BYTES = 795_000_000;
export const SIZE_ADAPTER_BYTES = 86_000_000;
/** config + tokenizer + graphe (~5 MB) */
export const SIZE_OVERHEAD_BYTES = 5_000_000;
export const CALLER_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES + SIZE_OVERHEAD_BYTES;

/** Bornes de génération du contrat (256 min caller — 64 tronquait l'annonce+appel). */
export const CALLER_MAX_NEW_TOKENS = 256;
export const EXECUTOR_MAX_NEW_TOKENS = 12_000;

/**
 * Versions des adapters publiés — à BUMPER quand Paul republie un `.data` sur
 * HF (les markers localStorage déclencheront le modal de re-téléchargement).
 */
export const ADAPTER_VERSIONS: Record<AdapterName, string> = {
  'souffleur-chat': 'v0.1-int8',
  'souffleur-pdf': 'v0.1-int8',
  'souffleur-xlsx-docx': 'v0.1-int8',
  'souffleur-sandbox': 'v0.1-int8',
};
