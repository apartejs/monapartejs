import { ASSISTANT_NAME, SOUFFLEUR_TOOL_DEFS, SP_CORE_TEMPLATE } from './tool-defs';

/** Référence de fichier joint, telle que sérialisée dans le bloc « Files available ». */
export interface SouffleurFileRef {
  id: string;
  name: string;
  type: string;
}

/**
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
