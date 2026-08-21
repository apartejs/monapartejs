/**
 * Schéma Dexie de monaparte — iso au schéma v2 d'aimi (split storage) :
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

/**
 * Fichiers du registre souffleurs — TABLE À PART, et pas `attachments`.
 * Ce sont deux choses différentes : `attachments` porte les pièces jointes de
 * la lib (ids UUID, scopées par conversation, purgées avec elle), tandis qu'ici
 * les ids sont ceux que le MODÈLE recopie (`file_<base36>_<n>`, format iso
 * training) et doivent survivre indépendamment des conversations.
 */
export interface SouffleurFileRow {
  id: string;
  name: string;
  /** Type du bloc « Files available » (xlsx/pdf/image/txt…). */
  type: string;
  mimeType: string;
  blob: Blob;
  addedAt: number;
}

export class monaparteDb extends Dexie {
  conversations!: Table<ConversationRow, string>;
  messages!: Table<MessageRow, string>;
  attachments!: Table<AparteAttachmentRow & { convId: string }, string>;
  /** blob + preview (dans `content`) persistés pour réhydrater les cartes après reload. */
  artifacts!: Table<AparteArtifactRow & { blob?: Blob }, string>;
  memory!: Table<AparteMemoryFact, string>;
  settings!: Table<SettingRow, string>;
  folders!: Table<FolderRow, string>;
  /** Registre des `file_id` vus par le modèle — voir SouffleurFileRow. */
  souffleurFiles!: Table<SouffleurFileRow, string>;

  constructor(name = 'monaparte') {
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
    // v2 : registre des fichiers souffleurs. Ajout d'une table uniquement —
    // aucune donnée existante n'est touchée.
    this.version(2).stores({
      souffleurFiles: 'id, addedAt',
    });
  }
}
