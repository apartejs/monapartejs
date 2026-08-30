/**
 * The compaction digest — what replaces the turns a compaction drops.
 *
 * It is NOT a summary written by the model. Measured on souffleur-chat 0.3.0
 * (six generations, two conditions, three lengths): asked to summarise, it
 * either refuses, answers as if continuing the chat, or — worst — invents. One
 * run produced a second client's amounts that appeared nowhere in the
 * transcript. A summary that silently drops the figures, or adds some, is worse
 * than no compaction: everything after it is built on the invention.
 *
 * So this states facts instead. Everything below is read off the dropped
 * messages; nothing is generated. The result is read by the model AND shown to
 * the user, hence the localised labels.
 */
import type { AparteMessage, AparteToolCallSegment } from '@aparte/core';

export interface CompactionDigestLabels {
  /** "%n earlier turns were removed from the context." — `%n` is substituted. */
  dropped: string;
  /** Heading for the first thing the user asked. */
  intent: string;
  /** Heading for the files the dropped turns produced. */
  files: string;
  /** Heading for the tools the dropped turns ran. */
  tools: string;
}

/** Longest intent line kept; past this the model gains nothing and pays tokens. */
const INTENT_MAX = 240;

const isToolCall = (s: { type: string }): s is AparteToolCallSegment => s.type === 'tool_call';

/** A message's plain text, whether it streamed into segments or not. */
function textOf(message: AparteMessage): string {
  const fromSegments = (message.segments ?? [])
    .filter((s) => s.type === 'text')
    .map((s) => (s as { content?: string }).content ?? '')
    .join(' ')
    .trim();
  return fromSegments || (message.content ?? '').trim();
}

/**
 * A file name a tool produced. Prefers `structuredResult` (aparté 0.16: the
 * handler's own value, no parsing) and falls back to the JSON our tools put in
 * `result` — defensively, because a failed call puts a sentence there instead.
 */
function fileNameOf(segment: AparteToolCallSegment): string | null {
  const fromStructured = segment.structuredResult as { file?: unknown; name?: unknown } | undefined;
  const structured = fromStructured?.file ?? fromStructured?.name;
  if (typeof structured === 'string' && structured) return structured;

  if (!segment.result) return null;
  try {
    const parsed = JSON.parse(segment.result) as { file?: unknown; name?: unknown };
    const value = parsed.file ?? parsed.name;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Build the digest for a set of dropped messages. Pure: same input, same string.
 * Returns '' when there is nothing truthful to say, which the caller reads as
 * "put no notice at all".
 */
export function buildCompactionDigest(
  dropped: readonly AparteMessage[],
  labels: CompactionDigestLabels,
): string {
  if (!dropped.length) return '';

  const lines: string[] = [labels.dropped.replace('%n', String(dropped.length))];

  const firstUser = dropped.find((m) => m.role === 'user');
  const intent = firstUser ? textOf(firstUser) : '';
  if (intent) {
    const clipped = intent.length > INTENT_MAX ? `${intent.slice(0, INTENT_MAX)}…` : intent;
    lines.push(`${labels.intent} : ${clipped}`);
  }

  const files: string[] = [];
  const tools: string[] = [];
  for (const message of dropped) {
    for (const segment of message.segments ?? []) {
      if (!isToolCall(segment)) continue;
      const name = segment.toolCall.name;
      if (name && !tools.includes(name)) tools.push(name);
      // Only a call that actually resolved may claim to have produced a file.
      if (segment.status !== 'resolved') continue;
      const file = fileNameOf(segment);
      if (file && !files.includes(file)) files.push(file);
    }
  }

  if (files.length) lines.push(`${labels.files} : ${files.join(', ')}`);
  if (tools.length) lines.push(`${labels.tools} : ${tools.join(', ')}`);

  return lines.join('\n');
}
