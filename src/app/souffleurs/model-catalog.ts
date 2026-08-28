/** Catalogue des souffleurs — repo HF, adapters, tailles (pour la progression pondérée). */

export const SOUFFLEURS_HF_REPO = 'maxituc/aparte-souffleurs';

export type AdapterName =
  'souffleur-chat' | 'souffleur-pdf' | 'souffleur-xlsx-docx' | 'souffleur-sandbox';

export const CALLER_ADAPTER: AdapterName = 'souffleur-chat';

/**
 * Vision (ADR-001) — MÊME repo, MÊMES poids, MÊME graphe que le texte.
 * Le graphe publié (`onnx/model_vision_q4.onnx`) est notre base avec une porte
 * d'entrée `image_features`/`image_indices` greffée : bit-identique en texte
 * (écart de logits mesuré 0.000e+00), donc utilisé pour tout. Le seul artefact
 * en plus est la TOUR (`vision-tower-<ver>`, ~269 Mo), décrite par le bloc
 * `vision` du manifest et rattachée en session à part à la 1ʳᵉ image.
 * Produit par `aparte-repetitions/export/graft_image_embeds.py`.
 */

/**
 * Bornes de l'appel describe. 128 tronquait : une description détaillée AVEC
 * transcription du texte visible (logo, capture d'écran, document photographié)
 * dépasse largement. Ça reste borné — le résultat nourrit un tour d'outil, pas
 * une réponse à l'utilisateur.
 */
export const VISION_MAX_NEW_TOKENS = 320;

/** Id du modèle visible côté aparté (sélecteur, model config). */
export const CALLER_MODEL_ID = 'souffleur-chat';

// Les chemins de fichiers (base + adapters versionnés) sont résolus par le
// manifest.json du repo HF — voir ./manifest.ts. Plus aucun chemin en dur ici.

/** Tailles approximatives (progression + textes d'onboarding générés, jamais codées en dur ailleurs). */
export const SIZE_BASE_BYTES = 795_000_000;
export const SIZE_ADAPTER_BYTES = 86_000_000;
/** config + tokenizer + graphe (~5 MB) */
export const SIZE_OVERHEAD_BYTES = 5_000_000;
export const CALLER_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES + SIZE_OVERHEAD_BYTES;
/** Base + les 4 souffleurs (caller + 3 exécuteurs) — annoncé à l'onboarding. */
export const TOTAL_DOWNLOAD_BYTES = SIZE_BASE_BYTES + SIZE_ADAPTER_BYTES * 4 + SIZE_OVERHEAD_BYTES;

export const EXECUTOR_ADAPTERS = [
  'souffleur-xlsx-docx',
  'souffleur-pdf',
  'souffleur-sandbox',
] as const satisfies readonly AdapterName[];

/** Bornes de génération du contrat (256 min caller — 64 tronquait l'annonce+appel). */
export const CALLER_MAX_NEW_TOKENS = 256;
export const EXECUTOR_MAX_NEW_TOKENS = 12_000;

// Le versioning des poids est porté par manifest.json (fichiers immuables
// versionnés) — publier une nouvelle version = nouveau nom + bump du manifest,
// AUCUN changement de code ici.
