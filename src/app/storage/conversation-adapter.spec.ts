import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AparteConversation } from '@aparte/core';
import { createIdbStorage } from '@aparte/plugin-storage-idb';
import { monaparteDb } from './db';
import { MonaparteStorage } from './conversation-adapter';
import { fileRegistry, setConversationResolver } from '../souffleurs/files/file-registry';
import { EXPORT_KIND, clearAll, exportAll, importAll } from './export-import';

let counter = 0;

function makeConv(overrides: Partial<AparteConversation> = {}): AparteConversation {
  const id = overrides.id ?? `conv-${++counter}`;
  const t = Date.now();
  return {
    id,
    title: `Conversation ${id}`,
    createdAt: t,
    updatedAt: t,
    messages: [
      { id: `${id}-m1`, role: 'user', content: 'Bonjour !', timestamp: t },
      {
        id: `${id}-m2`,
        role: 'assistant',
        content: 'Bonjour, comment puis-je aider ?',
        timestamp: t + 1,
      },
    ],
    ...overrides,
  };
}

/** A storage over its own two databases: Dexie for the app's tables, the plugin's for the conversations. */
function storageNamed(name: string): MonaparteStorage {
  return new MonaparteStorage(
    new monaparteDb(name),
    createIdbStorage({ name: `${name}-conversations` }),
  );
}

describe('MonaparteStorage', () => {
  let adapter: MonaparteStorage;

  beforeEach(() => {
    adapter = storageNamed(`test-${Date.now()}-${counter++}`);
  });

  it('save + loadAll: full round-trip, messages ordered', async () => {
    const conv = makeConv({ tree: { anything: true } as never });
    await adapter.save(conv);
    const all = await adapter.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(conv.id);
    expect(all[0].messages.map((m) => m.id)).toEqual([`${conv.id}-m1`, `${conv.id}-m2`]);
    expect(all[0].tree).toEqual({ anything: true });
  });

  it('save = upsert: re-saving replaces messages without duplicates', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    await adapter.save({
      ...conv,
      messages: [
        ...conv.messages,
        { id: `${conv.id}-m3`, role: 'user', content: 'Suite', timestamp: Date.now() + 2 },
      ],
    });
    const all = await adapter.loadAll();
    expect(all[0].messages).toHaveLength(3);
  });

  it('loadMeta: meta without messages', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    const meta = await adapter.loadMeta();
    expect(meta[0].title).toBe(conv.title);
    expect((meta[0] as Record<string, unknown>)['messages']).toBeUndefined();
  });

  it('keeps autoTitle — without it every automatic title reads as typed after a reload', async () => {
    const conv = makeConv({ autoTitle: true });
    await adapter.save(conv);
    expect((await adapter.loadFull(conv.id))?.autoTitle).toBe(true);
  });

  it('delete: cascades messages', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    await adapter.delete(conv.id);
    expect(await adapter.loadAll()).toHaveLength(0);
    expect(await adapter.loadFull(conv.id)).toBeNull();
  });

  it('delete: also cascades the artifacts of the conversation', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    await adapter.db.artifacts.put({
      id: 'a1',
      convId: conv.id,
      name: 'facture.pdf',
      kind: 'pdf',
      updatedAt: Date.now(),
    } as never);
    await adapter.delete(conv.id);
    expect(await adapter.db.artifacts.count()).toBe(0);
  });

  it('delete: also cascades the souffleurs registry files', async () => {
    const conv = makeConv();
    await adapter.save(conv);

    setConversationResolver(() => conv.id);
    const entry = fileRegistry.registerBlob(new Blob(['x']), 'pr.jpg', 'image/jpeg');
    await adapter.db.souffleurFiles.put({
      id: entry.id,
      name: entry.name,
      type: entry.type,
      mimeType: entry.mime,
      blob: entry.blob,
      addedAt: entry.addedAt,
      convId: conv.id,
    });

    await adapter.delete(conv.id);

    expect(await adapter.db.souffleurFiles.count()).toBe(0);
    // And the in-memory Map too, otherwise the file_id still resolves until reload.
    expect(fileRegistry.get(entry.id)).toBeUndefined();
    setConversationResolver(null);
  });

  it('archive / unarchive', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    await adapter.archive(conv.id);
    expect((await adapter.loadMeta())[0].archivedAt).toBeTypeOf('number');
    await adapter.unarchive(conv.id);
    expect((await adapter.loadMeta())[0].archivedAt).toBeUndefined();
  });

  it('settings k/v + memory', async () => {
    await adapter.setSetting('send-on-enter', false);
    expect(await adapter.getSetting('send-on-enter')).toBe(false);
    await adapter.addMemoryFact({
      id: 'f1',
      type: 'preference',
      content: 'aime le thé',
      addedAt: Date.now(),
    });
    expect(await adapter.getMemory()).toHaveLength(1);
    await adapter.clearMemory();
    expect(await adapter.getMemory()).toHaveLength(0);
  });

  it('export → import (merge) → clearAll', async () => {
    await adapter.save(makeConv());
    await adapter.setSetting('nickname', 'Paul');
    const dump = await exportAll(adapter);
    expect(dump.kind).toBe(EXPORT_KIND);
    expect(dump.conversations).toHaveLength(1);

    const target = storageNamed(`test-import-${Date.now()}`);
    const result = await importAll(target, dump);
    expect(result.conversations).toBe(1);
    expect(await target.getSetting('nickname')).toBe('Paul');

    await clearAll(target);
    expect(await target.loadAll()).toHaveLength(0);
    expect(await target.getAllSettings()).toEqual({});
  });

  it('import: rejects a foreign JSON', async () => {
    await expect(importAll(adapter, { kind: 'autre' })).rejects.toThrow(/invalide/);
  });
});

/**
 * Regression: the lib's `filesToAttachments()` sets a message's `url` from
 * `URL.createObjectURL(file)`. This URL is REVOKED on page reload —
 * persisted as-is, the bubble showed
 * `GET blob:… net::ERR_FILE_NOT_FOUND`. So the blob is stored separately and
 * the `url` rebuilt on every hydration, in the messages AND IN THE TREE
 * (it's the tree that `importTree()` replays on reload).
 */
describe('MonaparteStorage — attachments on reload', () => {
  let adapter: MonaparteStorage;

  beforeEach(() => {
    adapter = storageNamed(`att-${Date.now()}-${counter++}`);
    // fake-indexeddb doesn't provide URL.createObjectURL: we simulate it and
    // count the calls to prove the URL is indeed rebuilt.
    let n = 0;
    URL.createObjectURL = () => `blob:fresh-${++n}`;
  });

  const withAttachment = () => {
    const conv = makeConv();
    const blob = new Blob(['\x89PNG fake'], { type: 'image/png' });
    (conv.messages![0] as unknown as { attachments: unknown[] }).attachments = [
      {
        id: 'att-1',
        name: 'photo.png',
        type: 'image/png',
        // URL from the PREVIOUS session: dead after reload.
        url: 'blob:http://localhost:4200/dead-uuid',
        size: blob.size,
        blob,
      },
    ];
    conv.tree = {
      headId: `${conv.id}-m2`,
      messages: conv.messages!.map((m) => ({ parentId: undefined, message: m })),
    } as never;
    return conv;
  };

  it('the dead url is replaced, the blob survives', async () => {
    const conv = withAttachment();
    await adapter.save(conv);
    const loaded = await adapter.loadFull(conv.id);

    const atts = (
      loaded!.messages![0] as unknown as {
        attachments: { url: string; blob: Blob; name: string }[];
      }
    ).attachments;
    expect(atts).toHaveLength(1);
    expect(atts[0].url).not.toBe('blob:http://localhost:4200/dead-uuid');
    expect(atts[0].url).toMatch(/^blob:fresh-/);
    expect(atts[0].name).toBe('photo.png');
    expect(atts[0].blob).toBeInstanceOf(Blob);
    expect(await atts[0].blob.text()).toContain('PNG fake');
  });

  it('the TREE is also rewritten — otherwise importTree() replays dead urls', async () => {
    const conv = withAttachment();
    await adapter.save(conv);
    const loaded = await adapter.loadFull(conv.id);

    const tree = loaded!.tree as unknown as {
      messages: { message: { id: string; attachments?: { url: string }[] } }[];
    };
    const first = tree.messages.find((n) => n.message.id === `${conv.id}-m1`);
    expect(first?.message.attachments?.[0].url).toMatch(/^blob:fresh-/);
  });

  it('the file is kept apart, by message', async () => {
    const conv = withAttachment();
    await adapter.save(conv);

    const rows = await adapter.loadAttachments(`${conv.id}-m1`);
    expect(rows).toHaveLength(1);
    expect(rows[0].blob).toBeInstanceOf(Blob);
    expect(rows[0].convId).toBe(conv.id);
  });

  it('purging the conversation: attachments follow', async () => {
    const conv = withAttachment();
    await adapter.save(conv);
    await adapter.delete(conv.id);
    expect(await adapter.loadAttachments(`${conv.id}-m1`)).toHaveLength(0);
  });
});

/**
 * Until 0.32, monaparte kept conversations in its own Dexie tables. They move, once, into
 * @aparte/plugin-storage-idb's database: each conversation is saved there, read back, and only
 * then removed from the old tables — a move, so a conversation deleted afterwards cannot come
 * back from them, and one that failed to move stays where it was for the next start.
 */
describe('MonaparteStorage — moving the conversations of the Dexie tables', () => {
  let name: string;

  beforeEach(() => {
    name = `move-${Date.now()}-${counter++}`;
    let n = 0;
    URL.createObjectURL = () => `blob:fresh-${++n}`;
  });

  /** A conversation as monaparte's Dexie adapter wrote it: meta + tree, messages apart, files apart. */
  async function legacy(db: monaparteDb, id: string): Promise<void> {
    const t = Date.now();
    await db.conversations.put({
      id,
      title: 'Facture Durand',
      createdAt: t,
      updatedAt: t,
      autoTitle: true,
      pinnedAt: t,
      lastMessagePreview: 'Voici la facture.',
      messageCount: 2,
      tree: null,
    } as never);
    await db.messages.bulkPut([
      {
        id: `${id}-m1`,
        convId: id,
        timestamp: t,
        data: { id: `${id}-m1`, role: 'user', content: 'Ma photo', timestamp: t },
      },
      {
        id: `${id}-m2`,
        convId: id,
        timestamp: t + 1,
        data: { id: `${id}-m2`, role: 'assistant', content: 'Voici la facture.', timestamp: t + 1 },
      },
    ] as never);
    await db.attachments.put({
      id: 'att-1',
      convId: id,
      msgId: `${id}-m1`,
      name: 'photo.png',
      mimeType: 'image/png',
      size: 9,
      blob: new Blob(['PNG bytes'], { type: 'image/png' }),
    });
  }

  it('moves every conversation, its order, its pin, its title flag and its files', async () => {
    const db = new monaparteDb(name);
    await legacy(db, 'c1');
    const storage = new MonaparteStorage(db, createIdbStorage({ name: `${name}-conversations` }));

    const meta = await storage.loadMeta();
    expect(meta.map((m) => m.id)).toEqual(['c1']);
    expect(meta[0].pinnedAt).toBeTypeOf('number');

    const conv = await storage.loadFull('c1');
    expect(conv?.autoTitle).toBe(true);
    expect(conv?.messages.map((m) => m.content)).toEqual(['Ma photo', 'Voici la facture.']);
    const att = (conv!.messages[0] as unknown as { attachments: { name: string; blob: Blob }[] })
      .attachments[0];
    expect(att.name).toBe('photo.png');
    expect(await att.blob.text()).toBe('PNG bytes');

    expect(await db.conversations.count()).toBe(0);
    expect(await db.messages.count()).toBe(0);
    expect(await db.attachments.count()).toBe(0);
  });

  it('a conversation deleted after the move does not come back on the next start', async () => {
    const db = new monaparteDb(name);
    await legacy(db, 'c1');
    const storage = new MonaparteStorage(db, createIdbStorage({ name: `${name}-conversations` }));
    await storage.delete('c1');

    const next = new MonaparteStorage(
      new monaparteDb(name),
      createIdbStorage({ name: `${name}-conversations` }),
    );
    expect(await next.loadMeta()).toEqual([]);
  });

  it('nothing to move: the plugin alone answers', async () => {
    const storage = new MonaparteStorage(
      new monaparteDb(name),
      createIdbStorage({ name: `${name}-conversations` }),
    );
    await storage.save(makeConv({ id: 'fresh' }));
    expect((await storage.loadMeta()).map((m) => m.id)).toEqual(['fresh']);
  });
});

/**
 * Regression from the bonaparte -> monaparte rename: the value written to
 * `kind` changed, so any save made BEFORE the rename was rejected on
 * import. An export is the user's archive: we write the new name, we
 * accept both.
 */
describe('export/import — kind compatibility', () => {
  let adapter: MonaparteStorage;

  beforeEach(() => {
    adapter = storageNamed(`kind-${Date.now()}-${counter++}`);
  });

  it('an export produced by the "bonaparte" version is still importable', async () => {
    await adapter.save(makeConv());
    const dump = await exportAll(adapter);
    const legacy = { ...dump, kind: 'bonaparte-full-export' } as unknown as typeof dump;

    await clearAll(adapter);
    await expect(importAll(adapter, legacy)).resolves.not.toThrow();
    expect((await adapter.loadMeta()).length).toBe(1);
  });

  it('a foreign kind is always rejected', async () => {
    const dump = await exportAll(adapter);
    const alien = { ...dump, kind: 'autre-appli-export' } as unknown as typeof dump;
    await expect(importAll(adapter, alien)).rejects.toThrow(/invalide/);
  });
});
