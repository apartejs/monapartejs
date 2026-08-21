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
// Module feuille du registre, pas le baril `../souffleurs` : celui-ci
// entrainerait les outils et le worker dans le morceau de code du stockage.
import { fileRegistry } from '../souffleurs/files/file-registry';
import { monaparteDb, type ConversationRow } from './db';

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
    // Les pièces jointes sortent du message : leur `url` est une `blob:`
    // révoquée au reload (ERR_FILE_NOT_FOUND), seul le `blob` a du sens en
    // base. On stocke le binaire à part et on refabrique l'URL à l'hydratation.
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
              // `attachments` retiré : le binaire va dans sa table.
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
        // Les fichiers du registre souffleurs partent aussi : ce sont des
        // binaires (une image, un tableur), et rien ne les rattache plus a
        // quoi que ce soit une fois le fil supprime. Les laisser, c'etait
        // garder indefiniment dans le navigateur des fichiers que
        // l'utilisateur croit avoir effaces — et, dans une application dont
        // toute la promesse est que rien ne quitte l'appareil, ce qui reste
        // SUR l'appareil doit obeir a la suppression.
        await this.db.souffleurFiles.where('convId').equals(id).delete();
      },
    );
    // La base est nettoyee ; la Map du registre, elle, vit en memoire et
    // survivrait jusqu'au prochain rechargement.
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
    const attachmentRows = await this.db.attachments.where('convId').equals(row.id).toArray();
    const fresh = freshAttachmentsByMsg(attachmentRows);
    const { tree, lastMessagePreview: _p, messageCount: _c, ...meta } = row;
    return {
      ...meta,
      messages: messages.map((m) => withAttachments(m.data, fresh)),
      // ⚠️ L'ARBRE AUSSI : c'est lui que `importTree()` rejoue au reload, donc
      // des URLs mortes ici et la bulle casse même si `messages` est correct.
      tree: rehydrateTree(tree, fresh) as AparteConversation['tree'],
    };
  }
}

/* ── Pièces jointes : blob persisté, `url` refabriquée à chaque session ───── */

type AttachmentRow = AparteAttachmentRow & { convId: string };

/** Retire `attachments` du message stocké (le binaire vit dans sa table). */
function stripAttachments(message: AparteMessage): AparteMessage {
  if (!('attachments' in message)) return message;
  const { attachments: _dropped, ...rest } = message as AparteMessage & { attachments?: unknown };
  return rest as AparteMessage;
}

/** Extrait les blobs des messages vers des lignes `attachments`. */
function extractAttachments(convId: string, messages: AparteMessage[]): AttachmentRow[] {
  const rows: AttachmentRow[] = [];
  for (const m of messages) {
    const atts = (m as AparteMessage & { attachments?: unknown }).attachments;
    if (!Array.isArray(atts)) continue;
    for (const a of atts as { id: string; name: string; type?: string; size?: number; blob?: Blob }[]) {
      if (!a?.blob) continue; // url seule (legacy) : rien à persister
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
 * Regroupe par msgId avec une `url` NEUVE. Les object URLs sont
 * session-scoped : jamais sérialisées, refabriquées à chaque chargement.
 * (Non révoquées, comme dans l'implémentation de référence : leur durée de vie
 * est celle de l'onglet.)
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

/** Réécrit les messages de l'arbre avec les MÊMES pièces jointes fraîches. */
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
