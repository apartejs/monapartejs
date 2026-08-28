/**
 * AparteStorageAdapter over Dexie/IndexedDB — the lib provides NO
 * implementation (the ConversationManager never touches storage).
 * Split storage: meta + tree in `conversations`, messages apart.
 */
import type {
  AparteAttachmentRow,
  AparteConversation,
  AparteConversationMeta,
  AparteMessage,
  AparteStorageAdapter,
} from '@aparte/core';
import { APARTE_CONVERSATION_SCHEMA_VERSION } from '@aparte/core';
// Leaf module of the registry, not the `../souffleurs` barrel: that one
// would drag the tools and the worker into the storage code chunk.
import { fileRegistry } from '../souffleurs/files/file-registry';
import { monaparteDb, type ArtifactRow, type ConversationRow, type MemoryFactRow } from './db';

export class DexieConversationAdapter implements AparteStorageAdapter {
  constructor(readonly db: monaparteDb = new monaparteDb()) {}

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
    // Attachments come out of the message: their `url` is a `blob:`
    // revoked on reload (ERR_FILE_NOT_FOUND), only the `blob` makes sense in
    // the DB. We store the binary apart and rebuild the URL at hydration.
    const attachmentRows = extractAttachments(conv.id, messages);

    await this.db.transaction(
      'rw',
      [this.db.conversations, this.db.messages, this.db.attachments],
      async () => {
        await this.db.conversations.put(row);
        await this.db.messages.where('convId').equals(conv.id).delete();
        if (messages.length) {
          await this.db.messages.bulkPut(
            messages.map((m, i) => ({
              id: m.id || `${conv.id}:${i}`,
              convId: conv.id,
              timestamp: m.timestamp || conv.updatedAt + i,
              // `attachments` removed: the binary goes into its own table.
              data: stripAttachments(m),
            })),
          );
        }
        await this.db.attachments.where('convId').equals(conv.id).delete();
        if (attachmentRows.length) await this.db.attachments.bulkPut(attachmentRows);
      },
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.conversations,
        this.db.messages,
        this.db.attachments,
        this.db.artifacts,
        this.db.souffleurFiles,
      ],
      async () => {
        await this.db.conversations.delete(id);
        await this.db.messages.where('convId').equals(id).delete();
        await this.db.attachments.where('convId').equals(id).delete();
        await this.db.artifacts.where('convId').equals(id).delete();
        // The souffleurs registry files go too: they are binaries (an
        // image, a spreadsheet), and nothing attaches them to anything
        // anymore once the thread is deleted. Leaving them would mean
        // keeping indefinitely in the browser files that the user believes
        // they erased — and, in an app whose whole promise is that nothing
        // leaves the device, what stays ON the device must obey deletion.
        await this.db.souffleurFiles.where('convId').equals(id).delete();
      },
    );
    // The DB is cleaned; the registry's Map, though, lives in memory and
    // would survive until the next reload.
    fileRegistry.dropConversation(id);
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

  /* ── Artifacts / attachments (consumed starting from D3) ── */

  async loadArtifacts(filter?: { convId?: string }): Promise<ArtifactRow[]> {
    if (filter?.convId) {
      return this.db.artifacts.where('convId').equals(filter.convId).reverse().sortBy('updatedAt');
    }
    return this.db.artifacts.orderBy('updatedAt').reverse().toArray();
  }

  async loadAttachments(msgId: string): Promise<AparteAttachmentRow[]> {
    return this.db.attachments.where('msgId').equals(msgId).toArray();
  }

  /* ── internal ── */

  private async hydrate(row: ConversationRow): Promise<AparteConversation> {
    const messages = await this.db.messages.where('convId').equals(row.id).sortBy('timestamp');
    const attachmentRows = await this.db.attachments.where('convId').equals(row.id).toArray();
    const fresh = freshAttachmentsByMsg(attachmentRows);
    const { tree, lastMessagePreview: _p, messageCount: _c, ...meta } = row;
    return {
      ...meta,
      messages: messages.map((m) => withAttachments(m.data, fresh)),
      // ⚠️ THE TREE TOO: it's what `importTree()` replays on reload, so
      // dead URLs here and the bubble breaks even if `messages` is correct.
      tree: rehydrateTree(tree, fresh) as AparteConversation['tree'],
    };
  }
}

/* ── Attachments: blob persisted, `url` rebuilt on every session ───── */

type AttachmentRow = AparteAttachmentRow & { convId: string };

/** Removes `attachments` from the stored message (the binary lives in its own table). */
function stripAttachments(message: AparteMessage): AparteMessage {
  if (!('attachments' in message)) return message;
  const { attachments: _dropped, ...rest } = message as AparteMessage & { attachments?: unknown };
  return rest as AparteMessage;
}

/** Extracts blobs from the messages into `attachments` rows. */
function extractAttachments(convId: string, messages: AparteMessage[]): AttachmentRow[] {
  const rows: AttachmentRow[] = [];
  for (const m of messages) {
    const atts = (m as AparteMessage & { attachments?: unknown }).attachments;
    if (!Array.isArray(atts)) continue;
    for (const a of atts as {
      id: string;
      name: string;
      type?: string;
      size?: number;
      blob?: Blob;
    }[]) {
      if (!a?.blob) continue; // url only (legacy): nothing to persist
      rows.push({
        id: a.id,
        convId,
        msgId: m.id,
        name: a.name,
        mimeType: a.type ?? a.blob.type ?? 'application/octet-stream',
        size: a.size ?? a.blob.size ?? 0,
        blob: a.blob,
      });
    }
  }
  return rows;
}

/**
 * Groups by msgId with a NEW `url`. Object URLs are session-scoped: never
 * serialized, rebuilt on every load.
 * (Not revoked, as in the reference implementation: their lifetime is that
 * of the tab.)
 */
function freshAttachmentsByMsg(rows: AttachmentRow[]): Map<string, unknown[]> {
  const byMsg = new Map<string, unknown[]>();
  for (const r of rows) {
    if (!r.blob) continue;
    const list = byMsg.get(r.msgId) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      type: r.mimeType,
      url: URL.createObjectURL(r.blob),
      size: r.size,
      blob: r.blob,
    });
    byMsg.set(r.msgId, list);
  }
  return byMsg;
}

function withAttachments(message: AparteMessage, fresh: Map<string, unknown[]>): AparteMessage {
  const atts = fresh.get(message.id);
  return atts?.length ? ({ ...message, attachments: atts } as AparteMessage) : message;
}

/** Rewrites the tree's messages with the SAME fresh attachments. */
function rehydrateTree(tree: unknown, fresh: Map<string, unknown[]>): unknown {
  if (!tree || typeof tree !== 'object' || fresh.size === 0) return tree ?? undefined;
  const t = tree as { headId?: string; messages?: { message: AparteMessage; parentId?: string }[] };
  if (!Array.isArray(t.messages)) return tree;
  return {
    ...t,
    messages: t.messages.map(({ message, parentId }) => ({
      parentId,
      message: withAttachments(message, fresh),
    })),
  };
}

function previewOf(message: AparteMessage): string {
  return (message.content ?? '').slice(0, 200);
}
