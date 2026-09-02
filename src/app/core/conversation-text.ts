/**
 * Reading text off a conversation — pure, and deliberately free of Angular so the
 * rules can be tested without a TestBed.
 *
 * Two callers: the compaction digest, which reads the turns it drops, and the titler,
 * which reads the first user message. They had the same private helper twice.
 */
import type { AparteConversation, AparteMessage } from '@aparte/core';

/**
 * A message's text, whether it streamed into segments or arrived whole. A streamed
 * reply keeps its prose in `segments`; `content` is the fallback for one that wrote
 * no segments at all.
 */
export function messageText(message: AparteMessage): string {
  const fromSegments = (message.segments ?? [])
    .filter((s) => s.type === 'text')
    .map((s) => (s as { content?: string }).content ?? '')
    .join(' ')
    .trim();
  return fromSegments || (message.content ?? '').trim();
}

/**
 * The text to title a conversation from, or null when it is not the moment.
 *
 * The moment is exactly one user message: before it there is nothing to read, and
 * after it the conversation is under way and its title is settled — retitling then
 * would overwrite a rename the person made by hand, which nothing on a conversation
 * lets us tell apart from an automatic one.
 */
export function firstUserTextToTitle(conversation: AparteConversation): string | null {
  const users = (conversation.messages ?? []).filter((m) => m.role === 'user');
  if (users.length !== 1) return null;
  const text = messageText(users[0]);
  return text.length ? text : null;
}
