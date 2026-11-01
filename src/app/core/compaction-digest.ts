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
 * the user (the checkpoint's "Show summary"), hence the localised labels.
 *
 * Since aparté 0.26 a compaction writes a checkpoint and deletes nothing, and the
 * plugin appends the conversation's first request verbatim to it: the digest no
 * longer repeats that request.
 */
import type { AparteChatRequest, AparteMessage, AparteToolCallSegment } from '@aparte/core';
import type {
  CompactionMessageSelector,
  CompactionSelection,
  CompactionSetupOptions,
} from '@aparte/plugin-compaction';

export interface CompactionDigestLabels {
  /** "%n earlier turns were removed from the context." — `%n` is substituted. */
  dropped: string;
  /** Heading for the files the dropped turns produced. */
  files: string;
  /** Heading for the tools the dropped turns ran. */
  tools: string;
}

const isToolCall = (s: { type: string }): s is AparteToolCallSegment => s.type === 'tool_call';

type FileFields = { filename?: unknown; file?: unknown; name?: unknown };

/** `filename` is what write_file and transform_file return; `file` and `name` are kept for any other tool. */
const fileField = (value: FileFields | undefined): unknown =>
  value?.filename ?? value?.file ?? value?.name;

/**
 * A file name a tool produced. Prefers `structuredResult` (aparté 0.16: the
 * handler's own value, no parsing) and falls back to the JSON our tools put in
 * `result` — defensively, because a failed call puts a sentence there instead.
 */
function fileNameOf(segment: AparteToolCallSegment): string | null {
  const structured = fileField(segment.structuredResult as FileFields | undefined);
  if (typeof structured === 'string' && structured) return structured;

  if (!segment.result) return null;
  try {
    const value = fileField(JSON.parse(segment.result) as FileFields);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Build the digest for a set of dropped messages, after the summary so far when an
 * earlier checkpoint exists. Pure: same input, same string. Returns '' when nothing
 * was dropped, which the plugin refuses as an empty summary.
 */
export function buildCompactionDigest(
  dropped: readonly AparteMessage[],
  labels: CompactionDigestLabels,
  summarySoFar?: string,
): string {
  if (!dropped.length) return '';

  const lines: string[] = [labels.dropped.replace('%n', String(dropped.length))];

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

  // One paragraph per fact: the checkpoint's "Show summary" draws it in Markdown,
  // where a single newline would run the facts together.
  return (summarySoFar ? [summarySoFar, ...lines] : lines).join('\n\n');
}

const SUMMARY_SO_FAR = 'Summary so far:\n';
const SINCE_THEN = '\n\nThe conversation since then:';

/**
 * The earlier checkpoint's summary, as the plugin hands it to a summariser: an update
 * request opens with "Summary so far:" and that summary, the first-request block
 * already taken off. `undefined` on a first compaction.
 */
export function summarySoFar(request: AparteChatRequest): string | undefined {
  const opening = request.messages[0]?.content;
  if (typeof opening !== 'string' || !opening.startsWith(SUMMARY_SO_FAR)) return undefined;
  const end = opening.indexOf(SINCE_THEN);
  return end < 0 ? undefined : opening.slice(SUMMARY_SO_FAR.length, end);
}

/**
 * The selection as the plugin will apply it. A checkpoint sits on a user message, so
 * the plugin moves the selector's cut back to the user turn that opens the kept
 * exchange — or forward, when going back would summarise nothing (its `cutAtUser`,
 * not exported). The digest counts the dropped turns, so it must see that cut, not
 * the selector's. Unchanged when no user turn can carry the checkpoint: the plugin
 * then skips.
 */
export function alignDropToUserTurn<M extends { id: string; role: string }>(
  messages: M[],
  selection: CompactionSelection<M>,
): CompactionSelection<M> {
  const dropped = new Set(selection.drop.map((m) => m.id));
  let boundary = 0;
  while (boundary < messages.length && dropped.has(messages[boundary].id)) boundary++;
  const last = messages.length - 1;
  if (boundary === 0 || last < 1) return selection;

  const start = Math.min(boundary, last);
  let cut: number | null = null;
  for (let i = start; i > 0 && cut === null; i--) if (messages[i].role === 'user') cut = i;
  for (let i = start + 1; i <= last && cut === null; i++) if (messages[i].role === 'user') cut = i;
  if (cut === null) return selection;
  return { drop: messages.slice(0, cut), keep: messages.slice(cut) };
}

/**
 * The selector and summariser `setupCompaction` gets: `select` aligned on the plugin's
 * cut, and the digest of exactly those turns in place of a model's summary. The
 * plugin runs one compaction at a time per chat and calls the selector right before
 * the summariser, so the capture cannot interleave.
 */
export function factualCompaction(
  select: CompactionMessageSelector,
  labels: () => CompactionDigestLabels,
): Required<Pick<CompactionSetupOptions, 'selector' | 'summarize'>> {
  let lastDropped: AparteMessage[] = [];
  return {
    selector: (messages) => {
      const selection = alignDropToUserTurn(messages, select(messages));
      lastDropped = selection.drop;
      return selection;
    },
    summarize: async (request) => {
      // Consumed, not just read: should a summarise ever run without the selector
      // having just run, the digest comes out empty — the plugin refuses an empty
      // summary and leaves the transcript as it was. A stale digest would state facts
      // about ANOTHER compaction, in a checkpoint the model then reads as true.
      const dropped = lastDropped;
      lastDropped = [];
      return buildCompactionDigest(dropped, labels(), summarySoFar(request));
    },
  };
}
