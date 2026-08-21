import { ASSISTANT_NAME, SOUFFLEUR_TOOL_DEFS, SP_CORE_TEMPLATE } from './tool-defs';

/** Référence de fichier joint, telle que sérialisée dans le bloc « Files available ». */
export interface SouffleurFileRef {
  id: string;
  name: string;
  type: string;
}

/**
 * MESURE, pour ne pas la refaire : ajouter au corps de sp-chat une phrase
 * affirmant « les fichiers de Files available SONT lisibles » ne change RIEN.
 * A/B sur le modèle réellement déployé (aparte-repetitions/export/run_souffleur.py
 * --ab, graphe injecté + adapter souffleur-chat) : sur « Bonjour, que sais-tu
 * faire ? » la réponse est identique AU TOKEN PRÈS, déni compris. Et sur les
 * demandes concrètes (« tu peux lire mes fichiers ? », « que peux-tu me dire de
 * cette image ? », « tu sais analyser un document ? ») le modèle appelle
 * correctement `read_file` — avec ET sans la phrase.
 *
 * Le défaut n'est donc PAS « il croit ne pas savoir lire des fichiers » : c'est
 * une auto-présentation mémorisée, déclenchée par la seule question d'inventaire
 * ouverte. Le prompt n'a pas de prise dessus ; le correctif est côté données
 * (aparte-repetitions), sur la forme « on lui demande ce qu'il sait faire ».
 * On garde donc le corps VERBATIM du contrat — 60 tokens par tour pour zéro
 * effet, ce n'était pas un échange acceptable.
 *
 * Assemble le prompt système du caller — format d'entraînement exact :
 * corps sp-chat + "\n\nList of tools: " + JSON + "\n\nFiles available: " + JSON.
 * Les outils sont émis dans l'ordre du contrat, quel que soit l'ordre d'activation ;
 * un nom inconnu du contrat est ignoré. Aucun outil actif → pas de bloc tools
 * (comportement du rendu d'entraînement).
 */
export function buildSystemPrompt(
  enabledToolNames: readonly string[],
  files: readonly SouffleurFileRef[] = [],
  assistantName: string = ASSISTANT_NAME,
): string {
  const enabled = new Set(enabledToolNames);
  const tools = SOUFFLEUR_TOOL_DEFS.filter((t) => enabled.has(t.name));

  let s = SP_CORE_TEMPLATE.replace('{{assistant}}', assistantName);
  if (tools.length) {
    s += '\n\nList of tools: ' + JSON.stringify(tools);
  }
  if (files.length) {
    s +=
      '\n\nFiles available: ' +
      JSON.stringify(files.map(({ id, name, type }) => ({ id, name, type })));
  }
  return s;
}
