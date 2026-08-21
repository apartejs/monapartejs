import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AparteConversation } from '@aparte/core';
import { monaparteDb } from './db';
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
    adapter = new DexieConversationAdapter(new monaparteDb(`test-${Date.now()}-${counter++}`));
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

    const target = new DexieConversationAdapter(new monaparteDb(`test-import-${Date.now()}`));
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

/**
 * Régression : `filesToAttachments()` de la lib pose sur le message un `url`
 * issu de `URL.createObjectURL(file)`. Cette URL est RÉVOQUÉE au rechargement
 * de page — persistée telle quelle, la bulle affichait
 * `GET blob:… net::ERR_FILE_NOT_FOUND`. Le blob est donc stocké à part et
 * l'`url` refabriquée à chaque hydratation, dans les messages ET DANS L'ARBRE
 * (c'est l'arbre que `importTree()` rejoue au reload).
 */
describe('DexieConversationAdapter — pièces jointes au reload', () => {
  let adapter: DexieConversationAdapter;

  beforeEach(() => {
    adapter = new DexieConversationAdapter(new monaparteDb(`att-${Date.now()}-${counter++}`));
    // fake-indexeddb n'apporte pas URL.createObjectURL : on le simule et on
    // compte les appels pour prouver que l'URL est bien refaite.
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
        // URL de la session PRÉCÉDENTE : morte après reload.
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

  it("l'url morte est remplacée, le blob survit", async () => {
    const conv = withAttachment();
    await adapter.save(conv);
    const loaded = await adapter.loadFull(conv.id);

    const atts = (loaded!.messages![0] as unknown as { attachments: { url: string; blob: Blob; name: string }[] })
      .attachments;
    expect(atts).toHaveLength(1);
    expect(atts[0].url).not.toBe('blob:http://localhost:4200/dead-uuid');
    expect(atts[0].url).toMatch(/^blob:fresh-/);
    expect(atts[0].name).toBe('photo.png');
    expect(atts[0].blob).toBeInstanceOf(Blob);
    expect(await atts[0].blob.text()).toContain('PNG fake');
  });

  it("l'ARBRE aussi est réécrit — sinon importTree() rejoue les urls mortes", async () => {
    const conv = withAttachment();
    await adapter.save(conv);
    const loaded = await adapter.loadFull(conv.id);

    const tree = loaded!.tree as unknown as {
      messages: { message: { id: string; attachments?: { url: string }[] } }[];
    };
    const first = tree.messages.find((n) => n.message.id === `${conv.id}-m1`);
    expect(first?.message.attachments?.[0].url).toMatch(/^blob:fresh-/);
  });

  it('le binaire ne vit QUE dans la table attachments, pas dans le message', async () => {
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

  it('purge de la conversation : les pièces jointes suivent', async () => {
    const conv = withAttachment();
    await adapter.save(conv);
    await adapter.delete(conv.id);
    expect(await adapter.db.attachments.where('convId').equals(conv.id).count()).toBe(0);
  });
});

/**
 * Régression du renommage bonaparte -> monaparte : la valeur écrite dans
 * `kind` a changé, donc toute sauvegarde faite AVANT le renommage était
 * rejetée à l'import. Un export est l'archive de l'utilisateur : on écrit le
 * nouveau nom, on accepte les deux.
 */
describe('export/import — compatibilité du kind', () => {
  let adapter: DexieConversationAdapter;

  beforeEach(() => {
    adapter = new DexieConversationAdapter(new monaparteDb(`kind-${Date.now()}-${counter++}`));
  });

  it('un export produit par la version « bonaparte » est encore importable', async () => {
    await adapter.save(makeConv());
    const dump = await exportAll(adapter);
    const legacy = { ...dump, kind: 'bonaparte-full-export' } as unknown as typeof dump;

    await clearAll(adapter);
    await expect(importAll(adapter, legacy)).resolves.not.toThrow();
    expect((await adapter.loadMeta()).length).toBe(1);
  });

  it('un kind étranger est toujours rejeté', async () => {
    const dump = await exportAll(adapter);
    const alien = { ...dump, kind: 'autre-appli-export' } as unknown as typeof dump;
    await expect(importAll(adapter, alien)).rejects.toThrow(/invalide/);
  });
});
