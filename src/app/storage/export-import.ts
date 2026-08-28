/**
 * Export / import / full erasure of local data (mirrors aimi):
 * a single JSON `{version, kind, conversations, memory, settings}`;
 * import = merge (never a silent replacement); erasure = everything.
 */
import type { AparteConversation } from '@aparte/core';
import type { MemoryFactRow } from './db';
import { DexieConversationAdapter } from './conversation-adapter';
import { LOCAL_KEYS, localRemove } from './settings.service';

export const EXPORT_KIND = 'monaparte-full-export';
/**
 * `kind` accepted on IMPORT. The bonaparte -> monaparte rename changed the
 * written value: without this list, any save made before the rename was
 * rejected ("Invalid export file"). We write the new one, we read
 * both — an export is the user's archive, not an internal detail.
 */
const ACCEPTED_KINDS: readonly string[] = [EXPORT_KIND, 'bonaparte-full-export'];

export interface FullExport {
  version: 1;
  kind: typeof EXPORT_KIND;
  exportedAt: number;
  conversations: AparteConversation[];
  memory: MemoryFactRow[];
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

/** Merges into the existing data. The caller reloads the page afterward. */
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

/** Erases everything: conversations, memory, IDB settings, local keys. The caller reloads. */
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
