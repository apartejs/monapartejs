import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AparteConversation } from '@aparte/core';
import { monaparteDb } from './db';
import { DexieConversationAdapter } from './conversation-adapter';
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

describe('DexieConversationAdapter', () => {
  let adapter: DexieConversationAdapter;

  beforeEach(() => {
    adapter = new DexieConversationAdapter(new monaparteDb(`test-${Date.now()}-${counter++}`));
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

  it('loadMeta: meta without messages, preview and count filled', async () => {
    await adapter.save(makeConv());
    const meta = await adapter.loadMeta();
    expect(meta[0].messageCount).toBe(2);
    expect(meta[0].lastMessagePreview).toContain('comment puis-je aider');
    expect((meta[0] as Record<string, unknown>)['messages']).toBeUndefined();
  });

  it('delete: cascades messages', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    await adapter.delete(conv.id);
    expect(await adapter.loadAll()).toHaveLength(0);
    expect(await adapter.db.messages.where('convId').equals(conv.id).count()).toBe(0);
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

    const target = new DexieConversationAdapter(new monaparteDb(`test-import-${Date.now()}`));
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
describe('DexieConversationAdapter — attachments on reload', () => {
  let adapter: DexieConversationAdapter;

  beforeEach(() => {
    adapter = new DexieConversationAdapter(new monaparteDb(`att-${Date.now()}-${counter++}`));
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

  it('the binary lives ONLY in the attachments table, not in the message', async () => {
    const conv = withAttachment();
    await adapter.save(conv);

    const rows = await adapter.db.attachments.where('convId').equals(conv.id).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].blob).toBeInstanceOf(Blob);
    expect(rows[0].msgId).toBe(`${conv.id}-m1`);

    const msgRow = await adapter.db.messages.get(`${conv.id}-m1`);
    expect(msgRow).toBeDefined();
    expect('attachments' in (msgRow!.data as object)).toBe(false);
  });

  it('purging the conversation: attachments follow', async () => {
    const conv = withAttachment();
    await adapter.save(conv);
    await adapter.delete(conv.id);
    expect(await adapter.db.attachments.where('convId').equals(conv.id).count()).toBe(0);
  });
});

/**
 * Regression from the bonaparte -> monaparte rename: the value written to
 * `kind` changed, so any save made BEFORE the rename was rejected on
 * import. An export is the user's archive: we write the new name, we
 * accept both.
 */
describe('export/import — kind compatibility', () => {
  let adapter: DexieConversationAdapter;

  beforeEach(() => {
    adapter = new DexieConversationAdapter(new monaparteDb(`kind-${Date.now()}-${counter++}`));
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
