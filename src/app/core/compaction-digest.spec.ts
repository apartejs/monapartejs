import { describe, expect, it } from 'vitest';
import { AparteConfig, type AparteChatRequest, type AparteMessage } from '@aparte/core';
import { setupCompaction, type CompactionTarget } from '@aparte/plugin-compaction';
import {
  alignDropToUserTurn,
  buildCompactionDigest,
  factualCompaction,
  summarySoFar,
  type CompactionDigestLabels,
} from './compaction-digest';

const LABELS: CompactionDigestLabels = {
  dropped: '%n tours antérieurs ont été retirés du contexte.',
  files: 'Fichiers produits',
  tools: 'Outils utilisés',
};

const user = (content: string): AparteMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  content,
  timestamp: 0,
});

const reply = (content: string): AparteMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  content,
  timestamp: 0,
});

/** The request as the plugin builds it when an earlier checkpoint exists (aparté 0.29). */
const updating = (summary: string, firstTurn: string): AparteChatRequest =>
  ({
    messages: [
      {
        role: 'user',
        content: `Summary so far:\n${summary}\n\nThe conversation since then:\n\n${firstTurn}`,
      },
    ],
  }) as AparteChatRequest;

const withTool = (
  name: string,
  status: 'resolved' | 'failed',
  extra: { result?: string; structuredResult?: unknown } = {},
): AparteMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  timestamp: 0,
  segments: [
    { id: 's0', type: 'text', content: 'Voilà.' },
    {
      id: 's1',
      type: 'tool_call',
      toolCall: { id: 't1', name, input: {} },
      status,
      ...extra,
    },
  ] as AparteMessage['segments'],
});

describe('buildCompactionDigest — facts only, never a generated summary', () => {
  it('says nothing when nothing was dropped', () => {
    expect(buildCompactionDigest([], LABELS)).toBe('');
  });

  it('counts the dropped turns, and leaves the first request to the plugin', () => {
    // Since aparté 0.26 the plugin appends the conversation's first request verbatim to
    // every checkpoint; repeating it here would pay for it twice.
    const digest = buildCompactionDigest([user('Fais-moi une facture'), user('Merci')], LABELS);
    expect(digest).toBe('2 tours antérieurs ont été retirés du contexte.');
  });

  it('keeps the summary so far, then adds what this compaction dropped', () => {
    const digest = buildCompactionDigest(
      [withTool('write_file', 'resolved', { structuredResult: { file: 'b.docx' } })],
      LABELS,
      '4 tours antérieurs ont été retirés du contexte.\n\nFichiers produits : a.xlsx',
    );
    expect(digest).toBe(
      '4 tours antérieurs ont été retirés du contexte.\n\nFichiers produits : a.xlsx\n\n' +
        '1 tours antérieurs ont été retirés du contexte.\n\nFichiers produits : b.docx\n\n' +
        'Outils utilisés : write_file',
    );
  });

  it('puts each fact in its own paragraph, as the checkpoint draws its summary in Markdown', () => {
    // A single newline is a soft break: the separator's "Show summary" ran the lines
    // together ("… write_file 2 tours antérieurs …"), seen in the browser.
    const digest = buildCompactionDigest([withTool('compute', 'resolved')], LABELS);
    expect(digest).toBe(
      '1 tours antérieurs ont été retirés du contexte.\n\nOutils utilisés : compute',
    );
  });

  it('says nothing when nothing was dropped, even with a summary so far', () => {
    expect(buildCompactionDigest([], LABELS, 'déjà résumé')).toBe('');
  });

  it('prefers structuredResult over parsing the result prose', () => {
    const digest = buildCompactionDigest(
      [
        withTool('write_file', 'resolved', {
          structuredResult: { file: 'devis.pdf' },
          result: '{"file":"ignore-moi.pdf"}',
        }),
      ],
      LABELS,
    );
    expect(digest).toContain('Fichiers produits : devis.pdf');
    expect(digest).not.toContain('ignore-moi.pdf');
  });

  it('falls back to the JSON result when there is no structured value', () => {
    const digest = buildCompactionDigest(
      [withTool('write_file', 'resolved', { result: '{"ok":true,"file":"facture.xlsx"}' })],
      LABELS,
    );
    expect(digest).toContain('Fichiers produits : facture.xlsx');
  });

  it('reads the file name our file tools actually return', () => {
    // write_file and transform_file return `filename` — seen missing from a live
    // checkpoint's digest in the browser.
    const digest = buildCompactionDigest(
      [
        withTool('write_file', 'resolved', {
          result: '{"ok":true,"type":"pdf","filename":"facture-durand.pdf","size_kb":8.6}',
        }),
      ],
      LABELS,
    );
    expect(digest).toContain('Fichiers produits : facture-durand.pdf');
  });

  it('survives a result that is a sentence, not JSON', () => {
    const digest = buildCompactionDigest(
      [withTool('read_file', 'resolved', { result: 'fichier illisible' })],
      LABELS,
    );
    expect(digest).toContain('Outils utilisés : read_file');
    expect(digest).not.toContain('Fichiers produits');
  });

  it('never claims a file from a call that did not resolve', () => {
    const digest = buildCompactionDigest(
      [withTool('write_file', 'failed', { result: '{"file":"jamais-ecrit.pdf"}' })],
      LABELS,
    );
    expect(digest).not.toContain('jamais-ecrit.pdf');
    expect(digest).toContain('Outils utilisés : write_file');
  });

  it('lists each tool and each file once', () => {
    const digest = buildCompactionDigest(
      [
        withTool('write_file', 'resolved', { structuredResult: { file: 'a.pdf' } }),
        withTool('write_file', 'resolved', { structuredResult: { file: 'a.pdf' } }),
        withTool('compute', 'resolved'),
      ],
      LABELS,
    );
    expect(digest.match(/a\.pdf/g)).toHaveLength(1);
    expect(digest).toContain('Outils utilisés : write_file, compute');
  });

  it('invents nothing: every token of the digest comes from the input', () => {
    const digest = buildCompactionDigest([user('Dossier Belfort')], LABELS);
    expect(digest).not.toMatch(/Mulhouse|TTC|€/);
  });
});

describe('summarySoFar — the earlier checkpoint the plugin hands back', () => {
  it('reads the summary an update request opens with', () => {
    expect(
      summarySoFar(updating('4 tours retirés.\nFichiers produits : a.xlsx', 'Et ensuite ?')),
    ).toBe('4 tours retirés.\nFichiers produits : a.xlsx');
  });

  it('finds none in a first compaction', () => {
    expect(
      summarySoFar({ messages: [{ role: 'user', content: 'Bonjour' }] } as AparteChatRequest),
    ).toBe(undefined);
  });
});

describe('alignDropToUserTurn — the cut the plugin will make', () => {
  const [u1, a1, u2, a2, u3, a3] = [
    user('u1'),
    reply('a1'),
    user('u2'),
    reply('a2'),
    user('u3'),
    reply('a3'),
  ];
  const all = [u1, a1, u2, a2, u3, a3];

  it('moves a cut that stops mid-exchange back to the user turn', () => {
    const aligned = alignDropToUserTurn(all, { drop: [u1, a1, u2], keep: [a2, u3, a3] });
    expect(aligned).toEqual({ drop: [u1, a1], keep: [u2, a2, u3, a3] });
  });

  it('leaves a cut that already lands on a user turn alone', () => {
    const aligned = alignDropToUserTurn(all, { drop: [u1, a1], keep: [u2, a2, u3, a3] });
    expect(aligned).toEqual({ drop: [u1, a1], keep: [u2, a2, u3, a3] });
  });

  it('moves it forward when going back would summarise nothing', () => {
    const aligned = alignDropToUserTurn(all, { drop: [u1], keep: [a1, u2, a2, u3, a3] });
    expect(aligned).toEqual({ drop: [u1, a1], keep: [u2, a2, u3, a3] });
  });

  it('changes nothing when no user turn can carry the checkpoint', () => {
    const selection = { drop: [u1], keep: [a1] };
    expect(alignDropToUserTurn([u1, a1], selection)).toBe(selection);
  });
});

describe('factualCompaction — under the real plugin', () => {
  const long = (label: string) => `${label} ${'détail '.repeat(80)}`;
  const FIRST_REQUEST_LINE = "The conversation's first request, verbatim:";

  const setup = (
    messages: AparteMessage[],
    select: (ms: AparteMessage[]) => { drop: AparteMessage[]; keep: AparteMessage[] },
  ) => {
    const target: CompactionTarget = {
      getMessages: () => messages,
      updateMessage: (id, updates) =>
        Object.assign(
          messages.find((m) => m.id === id)!,
          updates,
        ),
    };
    return setupCompaction(
      { ...factualCompaction(select, () => LABELS), listen: false, resolveTarget: () => target },
      new AparteConfig(),
    );
  };

  it('digests exactly the turns the plugin summarises when it moves the cut', async () => {
    const messages = [
      user(long('u1')),
      reply('a1'),
      user(long('u2')),
      reply('a2'),
      user('u3'),
      reply('a3'),
    ];
    // Stops mid-exchange: a2 cannot carry a checkpoint, so the plugin keeps u2 too.
    const controller = setup(messages, (ms) => ({ drop: ms.slice(0, 3), keep: ms.slice(3) }));

    const outcome = await controller.compact({ force: true, reason: 'manual' });

    expect(outcome).toMatchObject({ ok: true, dropped: 2 });
    expect(messages[2].contextSummary?.summary).toMatch(/^2 tours antérieurs/);
    controller.dispose();
  });

  it('keeps the first digest when a second compaction updates it', async () => {
    const messages = [
      user(long('u1')),
      withTool('write_file', 'resolved', { structuredResult: { file: 'a.xlsx' } }),
      user(long('u2')),
      withTool('write_file', 'resolved', { structuredResult: { file: 'b.docx' } }),
      user('u3'),
      reply('a3'),
    ];
    const controller = setup(messages, (ms) => ({ drop: ms.slice(0, 2), keep: ms.slice(2) }));

    await controller.compact({ force: true, reason: 'manual' });
    const outcome = await controller.compact({ force: true, reason: 'manual' });

    expect(outcome).toMatchObject({ ok: true, dropped: 2, count: 4 });
    const summary = messages[4].contextSummary?.summary ?? '';
    expect(summary).toContain('Fichiers produits : a.xlsx');
    expect(summary).toContain('Fichiers produits : b.docx');
    expect(summary.split(FIRST_REQUEST_LINE)).toHaveLength(2);
    controller.dispose();
  });
});
