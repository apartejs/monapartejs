/**
 * Schéma Dexie de bonaparte — iso au schéma v2 d'aimi (split storage) :
 * méta de conversation d'un côté, messages/pièces jointes/artefacts/mémoire/
 * settings dans leurs tables. Candidat plugin @aparte/plugin-storage-indexeddb.
 */
import Dexie, { type Table } from 'dexie';
import type {
  AparteArtifactRow,
  AparteAttachmentRow,
  AparteConversationMeta,
  AparteMemoryFact,
  AparteMessage,
} from '@aparte/core';

export interface ConversationRow extends AparteConversationMeta {
  /** Arbre de branches complet (exportTree) — null si conversation linéaire. */
  tree: unknown | null;
}

export interface MessageRow {
  id: string;
  convId: string;
  timestamp: number;
  data: AparteMessage;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface FolderRow {
  id: string;
  name: string;
  updatedAt: number;
}

export class BonaparteDb extends Dexie {
  conversations!: Table<ConversationRow, string>;
  messages!: Table<MessageRow, string>;
  attachments!: Table<AparteAttachmentRow & { convId: string }, string>;
  artifacts!: Table<AparteArtifactRow, string>;
  memory!: Table<AparteMemoryFact, string>;
  settings!: Table<SettingRow, string>;
  folders!: Table<FolderRow, string>;

  constructor(name = 'bonaparte') {
    super(name);
    this.version(1).stores({
      conversations: 'id, updatedAt, archivedAt, pinnedAt, folderId',
      messages: 'id, convId, timestamp, [convId+timestamp]',
      attachments: 'id, convId, msgId, [convId+msgId]',
      artifacts: 'id, convId, updatedAt, [convId+updatedAt], name',
      memory: 'id, type, addedAt, lastUsedAt, sourceConvId',
      settings: 'key',
      folders: 'id, updatedAt',
    });
  }
}
