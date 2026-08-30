import { describe, expect, it } from 'vitest';
import type { AparteMessage } from '@aparte/core';
import { buildCompactionDigest, type CompactionDigestLabels } from './compaction-digest';

const LABELS: CompactionDigestLabels = {
  dropped: '%n tours antérieurs ont été retirés du contexte.',
  intent: 'Demande initiale',
  files: 'Fichiers produits',
  tools: 'Outils utilisés',
};

const user = (content: string): AparteMessage => ({
  id: crypto.randomUUID(),
  role: 'user',
  content,
  timestamp: 0,
});

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

  it('counts the dropped turns and keeps the first user intent', () => {
    const digest = buildCompactionDigest([user('Fais-moi une facture'), user('Merci')], LABELS);
    expect(digest).toContain('2 tours antérieurs ont été retirés du contexte.');
    expect(digest).toContain('Demande initiale : Fais-moi une facture');
  });

  it('clips a very long intent instead of paying for it', () => {
    const digest = buildCompactionDigest([user('a'.repeat(400))], LABELS);
    const line = digest.split('\n').find((l) => l.startsWith('Demande initiale'))!;
    expect(line.length).toBeLessThan(280);
    expect(line.endsWith('…')).toBe(true);
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
