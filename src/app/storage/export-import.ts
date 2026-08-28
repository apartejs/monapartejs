/**
 * Export / import / effacement complet des données locales (iso aimi) :
 * un seul JSON `{version, kind, conversations, memory, settings}` ;
 * import = merge (jamais de remplacement silencieux) ; effacement = tout.
 */
import type { AparteConversation, AparteMemoryFact } from '@aparte/core';
import { DexieConversationAdapter } from './conversation-adapter';
import { LOCAL_KEYS, localRemove } from './settings.service';

export const EXPORT_KIND = 'monaparte-full-export';
/**
 * `kind` accepté à l'IMPORT. Le renommage bonaparte -> monaparte a changé la
 * valeur écrite : sans cette liste, toute sauvegarde faite avant le renommage
 * était rejetée (« Fichier d'export invalide »). On écrit le nouveau, on lit
 * les deux — un export est une archive de l'utilisateur, pas un détail interne.
 */
const ACCEPTED_KINDS: readonly string[] = [EXPORT_KIND, 'bonaparte-full-export'];

export interface FullExport {
  version: 1;
  kind: typeof EXPORT_KIND;
  exportedAt: number;
  conversations: AparteConversation[];
  memory: AparteMemoryFact[];
  settings: Record<string, unknown>;
}

export async function exportAll(adapter: DexieConversationAdapter): Promise<FullExport> {
  return {
    version: 1,
    kind: EXPORT_KIND,
    exportedAt: Date.now(),
    conversations: await adapter.loadAll(),
    memory: await adapter.getMemory(),
    settings: await adapter.getAllSettings(),
  };
}

/** Merge dans l'existant. L'appelant recharge la page ensuite. */
export async function importAll(
  adapter: DexieConversationAdapter,
  data: unknown,
): Promise<{ conversations: number; memory: number }> {
  if (
    data === null ||
    typeof data !== 'object' ||
    !ACCEPTED_KINDS.includes((data as FullExport).kind) ||
    !Array.isArray((data as FullExport).conversations)
  ) {
    throw new Error(`Fichier d’export invalide (kind attendu : ${ACCEPTED_KINDS.join(' ou ')}).`);
  }
  const parsed = data as FullExport;
  for (const conv of parsed.conversations) {
    await adapter.save(conv);
  }
  for (const fact of parsed.memory ?? []) {
    await adapter.addMemoryFact(fact);
  }
  for (const [key, value] of Object.entries(parsed.settings ?? {})) {
    await adapter.setSetting(key, value);
  }
  return { conversations: parsed.conversations.length, memory: (parsed.memory ?? []).length };
}

/** Efface tout : conversations, mémoire, settings IDB, clés locales. L'appelant recharge. */
export async function clearAll(adapter: DexieConversationAdapter): Promise<void> {
  const conversations = await adapter.loadMeta();
  for (const conv of conversations) {
    await adapter.delete(conv.id);
  }
  await adapter.clearMemory();
  const settings = await adapter.getAllSettings();
  for (const key of Object.keys(settings)) {
    await adapter.deleteSetting(key);
  }
  for (const key of Object.values(LOCAL_KEYS)) {
    localRemove(key);
  }
}
