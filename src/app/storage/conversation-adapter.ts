/**
 * monaparte's storage. The conversations are @aparte/plugin-storage-idb's (aparté 0.32): split
 * storage, attachments kept as files, all-or-nothing saves. What only monaparte has stays in its
 * Dexie database: the artifacts, the souffleurs' file registry, the settings and the memory.
 *
 * Until 0.32 the conversations lived in Dexie tables too (`conversations`, `messages`,
 * `attachments`); they are moved into the plugin's database on the first call (`moveLegacy`).
 */
import type {
  AparteAttachmentRow,
  AparteConversation,
  AparteConversationMeta,
  AparteMessage,
  AparteStorageAdapter,
} from '@aparte/core';
import { createIdbStorage, type IdbStorage } from '@aparte/plugin-storage-idb';
// Leaf module of the registry, not the `../souffleurs` barrel: that one
// would drag the tools and the worker into the storage code chunk.
import { fileRegistry } from '../souffleurs/files/file-registry';
import { monaparteDb, type ArtifactRow, type ConversationRow, type MemoryFactRow } from './db';

export class MonaparteStorage implements AparteStorageAdapter {
  private moved?: Promise<void>;

  constructor(
    readonly db: monaparteDb = new monaparteDb(),
    readonly conversations: IdbStorage = createIdbStorage({ name: 'monaparte-conversations' }),
  ) {}

  async loadAll(): Promise<AparteConversation[]> {
    return (await this.ready()).loadAll();
  }

  async save(conv: AparteConversation): Promise<void> {
    await (await this.ready()).save(conv);
  }

  async delete(id: string): Promise<void> {
    await (await this.ready()).delete(id);
    await this.db.transaction(
      'rw',
      [
        this.db.artifacts,
        this.db.souffleurFiles,
        this.db.conversations,
        this.db.messages,
        this.db.attachments,
      ],
      async () => {
        await this.db.artifacts.where('convId').equals(id).delete();
        // The souffleurs registry files go too: they are binaries (an
        // image, a spreadsheet), and nothing attaches them to anything
        // anymore once the thread is deleted. Leaving them would mean
        // keeping indefinitely in the browser files that the user believes
        // they erased — and, in an app whose whole promise is that nothing
        // leaves the device, what stays ON the device must obey deletion.
        await this.db.souffleurFiles.where('convId').equals(id).delete();
        // A conversation that did not move yet must not come back from the old tables.
        await this.deleteLegacy(id);
      },
    );
    // The DB is cleaned; the registry's Map, though, lives in memory and
    // would survive until the next reload.
    fileRegistry.dropConversation(id);
  }

  async archive(id: string): Promise<void> {
    await (await this.ready()).archive(id);
  }

  async unarchive(id: string): Promise<void> {
    await (await this.ready()).unarchive(id);
  }

  async loadMeta(): Promise<AparteConversationMeta[]> {
    return (await this.ready()).loadMeta();
  }

  async loadFull(id: string): Promise<AparteConversation | null> {
    return (await this.ready()).loadFull(id);
  }

  async pin(id: string): Promise<void> {
    await (await this.ready()).pin(id);
  }

  async unpin(id: string): Promise<void> {
    await (await this.ready()).unpin(id);
  }

  async rename(id: string, title: string): Promise<void> {
    await (await this.ready()).rename(id, title);
  }

  async loadAttachments(msgId: string): Promise<AparteAttachmentRow[]> {
    return (await this.ready()).loadAttachments(msgId);
  }

  /* ── Memory ── */

  async getMemory(): Promise<MemoryFactRow[]> {
    return this.db.memory.orderBy('addedAt').reverse().toArray();
  }

  async addMemoryFact(fact: MemoryFactRow): Promise<void> {
    await this.db.memory.put(fact);
  }

  async updateMemoryFact(id: string, patch: Partial<MemoryFactRow>): Promise<void> {
    await this.db.memory.update(id, patch);
  }

  async deleteMemoryFact(id: string): Promise<void> {
    await this.db.memory.delete(id);
  }

  async clearMemory(): Promise<void> {
    await this.db.memory.clear();
  }

  /* ── Settings k/v ── */

  async getSetting<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.db.settings.get(key);
    return row?.value as T | undefined;
  }

  async setSetting<T = unknown>(key: string, value: T): Promise<void> {
    await this.db.settings.put({ key, value });
  }

  async deleteSetting(key: string): Promise<void> {
    await this.db.settings.delete(key);
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const rows = await this.db.settings.toArray();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /* ── Artifacts ── */

  async loadArtifacts(filter?: { convId?: string }): Promise<ArtifactRow[]> {
    if (filter?.convId) {
      return this.db.artifacts.where('convId').equals(filter.convId).reverse().sortBy('updatedAt');
    }
    return this.db.artifacts.orderBy('updatedAt').reverse().toArray();
  }

  /* ── The move out of the Dexie tables ── */

  /** The plugin's storage, once the old tables have been moved into it (the first call moves them). */
  private async ready(): Promise<IdbStorage> {
    this.moved ??= this.moveLegacy();
    await this.moved;
    return this.conversations;
  }

  /**
   * Each conversation of the old tables is saved into the plugin, read back, and only then
   * removed from them: a move. One that fails stays where it was, for the next start; the app
   * starts either way.
   */
  private async moveLegacy(): Promise<void> {
    let rows: ConversationRow[];
    try {
      rows = await this.db.conversations.toArray();
    } catch (err) {
      console.error('[monaparte] storage: the old conversation tables could not be read', err);
      return;
    }
    for (const row of rows) {
      try {
        const conv = await this.readLegacy(row);
        await this.conversations.save(conv);
        const back = await this.conversations.loadFull(conv.id);
        if (back?.messages.length !== conv.messages.length) {
          throw new Error(
            `read back ${back?.messages.length ?? 'nothing'} of ${conv.messages.length} messages`,
          );
        }
        await this.db.transaction(
          'rw',
          [this.db.conversations, this.db.messages, this.db.attachments],
          () => this.deleteLegacy(row.id),
        );
      } catch (err) {
        console.error(`[monaparte] storage: conversation ${row.id} stays in the old tables`, err);
      }
    }
  }

  private async deleteLegacy(id: string): Promise<void> {
    await this.db.conversations.delete(id);
    await this.db.messages.where('convId').equals(id).delete();
    await this.db.attachments.where('convId').equals(id).delete();
  }

  /** A conversation as the Dexie adapter wrote it: meta + tree, messages apart, files apart. */
  private async readLegacy(row: ConversationRow): Promise<AparteConversation> {
    const messages = await this.db.messages.where('convId').equals(row.id).sortBy('timestamp');
    const files = await this.db.attachments.where('convId').equals(row.id).toArray();
    const byMsg = filesByMessage(files);
    const { tree, lastMessagePreview: _p, messageCount: _c, folderId: _f, ...meta } = row;
    const conv: AparteConversation = {
      ...meta,
      messages: messages.map((m) => withFiles(m.data, byMsg)),
    };
    // The tree too: it is what `importTree()` replays on reload.
    if (tree) conv.tree = treeWithFiles(tree, byMsg) as AparteConversation['tree'];
    return conv;
  }
}

/* ── Old rows: the files go back into their messages, as blobs; the plugin keeps them ── */

type LegacyFileRow = AparteAttachmentRow & { convId: string };

function filesByMessage(rows: LegacyFileRow[]): Map<string, unknown[]> {
  const byMsg = new Map<string, unknown[]>();
  for (const r of rows) {
    if (!r.blob) continue;
    const list = byMsg.get(r.msgId) ?? [];
    list.push({ id: r.id, name: r.name, type: r.mimeType, url: '', size: r.size, blob: r.blob });
    byMsg.set(r.msgId, list);
  }
  return byMsg;
}

function withFiles(message: AparteMessage, byMsg: Map<string, unknown[]>): AparteMessage {
  const atts = byMsg.get(message.id);
  return atts?.length ? ({ ...message, attachments: atts } as AparteMessage) : message;
}

function treeWithFiles(tree: unknown, byMsg: Map<string, unknown[]>): unknown {
  if (!tree || typeof tree !== 'object' || byMsg.size === 0) return tree;
  const t = tree as { headId?: string; messages?: { message: AparteMessage; parentId?: string }[] };
  if (!Array.isArray(t.messages)) return tree;
  return {
    ...t,
    messages: t.messages.map(({ message, parentId }) => ({
      parentId,
      message: withFiles(message, byMsg),
    })),
  };
}
