/**
 * AparteStorageAdapter sur Dexie/IndexedDB — la lib ne fournit AUCUNE
 * implémentation (le ConversationManager ne touche jamais le stockage).
 * Split storage : méta + tree dans `conversations`, messages à part.
 */
import type {
  AparteArtifactRow,
  AparteAttachmentRow,
  AparteConversation,
  AparteConversationMeta,
  AparteMemoryFact,
  AparteMessage,
  AparteStorageAdapter,
} from '@aparte/core';
import { APARTE_CONVERSATION_SCHEMA_VERSION } from '@aparte/core';
import { BonaparteDb, type ConversationRow } from './db';

export class DexieConversationAdapter implements AparteStorageAdapter {
  constructor(readonly db: BonaparteDb = new BonaparteDb()) {}

  async loadAll(): Promise<AparteConversation[]> {
    const rows = await this.db.conversations.orderBy('updatedAt').reverse().toArray();
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async save(conv: AparteConversation): Promise<void> {
    const messages = conv.messages ?? [];
    const last = messages.at(-1);
    const row: ConversationRow = {
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      archivedAt: conv.archivedAt,
      pinnedAt: conv.pinnedAt,
      folderId: conv.folderId,
      lastMessagePreview: last ? previewOf(last) : undefined,
      messageCount: messages.length,
      schemaVersion: conv.schemaVersion ?? APARTE_CONVERSATION_SCHEMA_VERSION,
      tree: conv.tree ?? null,
    };
    await this.db.transaction('rw', this.db.conversations, this.db.messages, async () => {
      await this.db.conversations.put(row);
      await this.db.messages.where('convId').equals(conv.id).delete();
      if (messages.length) {
        await this.db.messages.bulkPut(
          messages.map((m, i) => ({
            id: m.id || `${conv.id}:${i}`,
            convId: conv.id,
            timestamp: m.timestamp || conv.updatedAt + i,
            data: m,
          })),
        );
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.conversations, this.db.messages, this.db.attachments, this.db.artifacts],
      async () => {
        await this.db.conversations.delete(id);
        await this.db.messages.where('convId').equals(id).delete();
        await this.db.attachments.where('convId').equals(id).delete();
        await this.db.artifacts.where('convId').equals(id).delete();
      },
    );
  }

  async archive(id: string): Promise<void> {
    await this.db.conversations.update(id, { archivedAt: Date.now() });
  }

  async unarchive(id: string): Promise<void> {
    await this.db.conversations.update(id, { archivedAt: undefined });
  }

  async loadMeta(): Promise<AparteConversationMeta[]> {
    const rows = await this.db.conversations.orderBy('updatedAt').reverse().toArray();
    return rows.map(({ tree: _tree, ...meta }) => meta);
  }

  async loadFull(id: string): Promise<AparteConversation | null> {
    const row = await this.db.conversations.get(id);
    return row ? this.hydrate(row) : null;
  }

  async pin(id: string): Promise<void> {
    await this.db.conversations.update(id, { pinnedAt: Date.now() });
  }

  async unpin(id: string): Promise<void> {
    await this.db.conversations.update(id, { pinnedAt: undefined });
  }

  async rename(id: string, title: string): Promise<void> {
    await this.db.conversations.update(id, { title });
  }

  /* ── Mémoire ── */

  async getMemory(): Promise<AparteMemoryFact[]> {
    return this.db.memory.orderBy('addedAt').reverse().toArray();
  }

  async addMemoryFact(fact: AparteMemoryFact): Promise<void> {
    await this.db.memory.put(fact);
  }

  async updateMemoryFact(id: string, patch: Partial<AparteMemoryFact>): Promise<void> {
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

  /* ── Artefacts / pièces jointes (consommés à partir du J3) ── */

  async loadArtifacts(filter?: { convId?: string }): Promise<AparteArtifactRow[]> {
    if (filter?.convId) {
      return this.db.artifacts.where('convId').equals(filter.convId).reverse().sortBy('updatedAt');
    }
    return this.db.artifacts.orderBy('updatedAt').reverse().toArray();
  }

  async loadAttachments(msgId: string): Promise<AparteAttachmentRow[]> {
    return this.db.attachments.where('msgId').equals(msgId).toArray();
  }

  /* ── interne ── */

  private async hydrate(row: ConversationRow): Promise<AparteConversation> {
    const messages = await this.db.messages
      .where('convId')
      .equals(row.id)
      .sortBy('timestamp');
    const { tree, lastMessagePreview: _p, messageCount: _c, ...meta } = row;
    return {
      ...meta,
      messages: messages.map((m) => m.data),
      tree: (tree ?? undefined) as AparteConversation['tree'],
    };
  }
}

function previewOf(message: AparteMessage): string {
  return (message.content ?? '').slice(0, 200);
}
