import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AparteConversation } from '@aparte/core';
import { BonaparteDb } from './db';
import { DexieConversationAdapter } from './conversation-adapter';
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
      { id: `${id}-m2`, role: 'assistant', content: 'Bonjour, comment puis-je aider ?', timestamp: t + 1 },
    ],
    ...overrides,
  };
}

describe('DexieConversationAdapter', () => {
  let adapter: DexieConversationAdapter;

  beforeEach(() => {
    adapter = new DexieConversationAdapter(new BonaparteDb(`test-${Date.now()}-${counter++}`));
  });

  it('save + loadAll : round-trip complet, messages ordonnés', async () => {
    const conv = makeConv({ tree: { anything: true } as never });
    await adapter.save(conv);
    const all = await adapter.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(conv.id);
    expect(all[0].messages.map((m) => m.id)).toEqual([`${conv.id}-m1`, `${conv.id}-m2`]);
    expect(all[0].tree).toEqual({ anything: true });
  });

  it('save = upsert : re-sauvegarde remplace les messages sans doublon', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    await adapter.save({
      ...conv,
      messages: [...conv.messages, { id: `${conv.id}-m3`, role: 'user', content: 'Suite', timestamp: Date.now() + 2 }],
    });
    const all = await adapter.loadAll();
    expect(all[0].messages).toHaveLength(3);
  });

  it('loadMeta : méta sans messages, preview et count remplis', async () => {
    await adapter.save(makeConv());
    const meta = await adapter.loadMeta();
    expect(meta[0].messageCount).toBe(2);
    expect(meta[0].lastMessagePreview).toContain('comment puis-je aider');
    expect((meta[0] as Record<string, unknown>)['messages']).toBeUndefined();
  });

  it('delete : cascade messages', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    await adapter.delete(conv.id);
    expect(await adapter.loadAll()).toHaveLength(0);
    expect(await adapter.db.messages.where('convId').equals(conv.id).count()).toBe(0);
  });

  it('archive / unarchive', async () => {
    const conv = makeConv();
    await adapter.save(conv);
    await adapter.archive(conv.id);
    expect((await adapter.loadMeta())[0].archivedAt).toBeTypeOf('number');
    await adapter.unarchive(conv.id);
    expect((await adapter.loadMeta())[0].archivedAt).toBeUndefined();
  });

  it('settings k/v + mémoire', async () => {
    await adapter.setSetting('send-on-enter', false);
    expect(await adapter.getSetting('send-on-enter')).toBe(false);
    await adapter.addMemoryFact({ id: 'f1', type: 'preference', content: 'aime le thé', addedAt: Date.now() });
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

    const target = new DexieConversationAdapter(new BonaparteDb(`test-import-${Date.now()}`));
    const result = await importAll(target, dump);
    expect(result.conversations).toBe(1);
    expect(await target.getSetting('nickname')).toBe('Paul');

    await clearAll(target);
    expect(await target.loadAll()).toHaveLength(0);
    expect(await target.getAllSettings()).toEqual({});
  });

  it('import : rejette un JSON étranger', async () => {
    await expect(importAll(adapter, { kind: 'autre' })).rejects.toThrow(/invalide/);
  });
});
