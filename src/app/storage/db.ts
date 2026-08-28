/**
 * monaparte's Dexie schema — mirrors aimi's v2 schema (split storage):
 * conversation meta on one side, messages/attachments/artifacts/memory/
 * settings in their own tables. Candidate for the @aparte/plugin-storage-indexeddb plugin.
 */
import Dexie, { type Table } from 'dexie';
import type { AparteAttachmentRow, AparteConversationMeta, AparteMessage } from '@aparte/core';

/**
 * Memory fact — OUR schema, not the library's. aparté 0.14 dropped
 * `AparteMemoryFact` from `@aparte/core` (one product's categories were
 * binding every adapter); the shape is aimi's, kept verbatim so existing
 * databases and exports keep loading. `remember` is not exposed to the
 * model yet (ADR-005): the table is reserved.
 */
export interface MemoryFactRow {
  id: string;
  type: 'identity' | 'fact' | 'preference' | 'tech' | 'project' | 'style';
  content: string;
  source?: 'manual' | 'auto' | 'onboarding';
  addedAt: number;
  lastUsedAt?: number;
  sourceConvId?: string;
  sourceMsgId?: string;
}

/**
 * Artifact row — denormalised index of produced artifacts (write_file,
 * transform_file, create_widget), with the blob and preview needed to
 * rehydrate a card after a reload. Ours since aparté 0.14 (same reason as
 * `MemoryFactRow`).
 */
export interface ArtifactRow {
  id: string;
  convId: string;
  msgId: string;
  name: string;
  mimeType: string;
  artifactType: string;
  /** Preview body (HTML/text), duplicated for fast display. */
  content: string;
  title?: string;
  updatedAt: number;
}

export interface ConversationRow extends AparteConversationMeta {
  /** Full branch tree (exportTree) — null if the conversation is linear. */
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
 * Files from the souffleurs registry — SEPARATE TABLE, not `attachments`.
 * These are two different things: `attachments` carries the lib's
 * attachments (UUID ids, scoped by conversation, purged with it), whereas
 * here the ids are the ones the MODEL copies back (`file_<base36>_<n>`,
 * format mirroring training) and must survive independently of conversations.
 */
export interface SouffleurFileRow {
  id: string;
  name: string;
  /** Type for the "Files available" block (xlsx/pdf/image/txt…). */
  type: string;
  mimeType: string;
  blob: Blob;
  addedAt: number;
  /**
   * Owning conversation — it decides whether the file enters the
   * "Files available" block. Three states, all meaningful:
   *  - a string: the file belongs to this conversation;
   *  - null: attached before the conversation existed (new thread), adopted
   *    as soon as it's created;
   *  - absent: row written before v3, unknown attachment. Never listed,
   *    but kept: the file_id's from history must stay resolvable.
   */
  convId?: string | null;
}

export class monaparteDb extends Dexie {
  conversations!: Table<ConversationRow, string>;
  messages!: Table<MessageRow, string>;
  attachments!: Table<AparteAttachmentRow & { convId: string }, string>;
  /** blob + preview (in `content`) persisted to rehydrate the cards after a reload. */
  artifacts!: Table<ArtifactRow & { blob?: Blob }, string>;
  memory!: Table<MemoryFactRow, string>;
  settings!: Table<SettingRow, string>;
  folders!: Table<FolderRow, string>;
  /** Registry of `file_id`s seen by the model — see SouffleurFileRow. */
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
    // v2: souffleurs files registry. Table addition only — no existing
    // data is touched.
    this.version(2).stores({
      souffleurFiles: 'id, addedAt',
    });
    // v3: attaching a file to its conversation. Without it, the registry
    // was global and the "Files available" block announced to the model
    // EVERY file ever attached, in any thread — it would then call
    // read_file on an image absent from the conversation (and attach the
    // vision tower for nothing). Index only: existing rows are not
    // rewritten, their `convId` stays absent, which the registry reads as
    // "unknown attachment".
    this.version(3).stores({
      souffleurFiles: 'id, addedAt, convId',
    });
  }
}
