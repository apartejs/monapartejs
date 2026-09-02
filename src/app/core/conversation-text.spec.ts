import { describe, expect, it } from 'vitest';
import type { AparteConversation, AparteMessage } from '@aparte/core';
import { firstUserTextToTitle, messageText } from './conversation-text';

const msg = (role: string, content: string, segments?: unknown[]): AparteMessage =>
  ({ id: crypto.randomUUID(), role, content, segments, timestamp: 0 }) as AparteMessage;

const conv = (messages: AparteMessage[]): AparteConversation =>
  ({ id: 'c1', title: '', messages, createdAt: 0, updatedAt: 0 }) as AparteConversation;

describe('messageText', () => {
  it('reads a plain message', () => {
    expect(messageText(msg('user', 'Fais-moi une facture'))).toBe('Fais-moi une facture');
  });

  it('prefers the text segments of a streamed reply, skipping the tool calls', () => {
    const m = msg('assistant', 'fallback', [
      { type: 'text', content: 'Voilà' },
      { type: 'tool_call', toolCall: { id: 't', name: 'write_file', input: {} } },
      { type: 'text', content: 'le devis.' },
    ]);
    expect(messageText(m)).toBe('Voilà le devis.');
  });

  it('falls back to content when the segments carry no text', () => {
    const m = msg('assistant', 'fallback', [
      { type: 'tool_call', toolCall: { id: 't', name: 'compute', input: {} } },
    ]);
    expect(messageText(m)).toBe('fallback');
  });
});

describe('firstUserTextToTitle — title once, at the first user message', () => {
  it('returns the text of the only user message', () => {
    const c = conv([msg('user', 'Explique-moi la photosynthèse'), msg('assistant', 'Bien sûr.')]);
    expect(firstUserTextToTitle(c)).toBe('Explique-moi la photosynthèse');
  });

  it('says nothing for an empty conversation', () => {
    expect(firstUserTextToTitle(conv([]))).toBeNull();
  });

  it('says nothing once a second user message exists — the title is settled', () => {
    const c = conv([msg('user', 'Premier'), msg('assistant', 'Ok'), msg('user', 'Second')]);
    expect(firstUserTextToTitle(c)).toBeNull();
  });

  it('says nothing when the assistant spoke first and no one has asked yet', () => {
    expect(firstUserTextToTitle(conv([msg('assistant', 'Bonjour')]))).toBeNull();
  });

  it('says nothing for a blank user message', () => {
    expect(firstUserTextToTitle(conv([msg('user', '   ')]))).toBeNull();
  });
});
