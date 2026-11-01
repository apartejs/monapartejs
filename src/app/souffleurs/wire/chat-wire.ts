import { contentToText } from '@aparte/core';
import type { AparteChatMessage } from '@aparte/core';
import { LFM3_SYSTEM_CORE, LFM3_TOOLS, type Lfm3Tool } from './contract-lfm3';
import type { SouffleurFileRef } from './system-prompt';

/**
 * The LFM3 souffleurs' wire (ADR-003): OpenAI-shaped messages and tools, rendered by the model's own chat template
 * inside the engine (llama.cpp's jinja, wllama's `createChatCompletion`) — the path the lab's bench measures with
 * llama-server `--jinja`. Unlike LFM2.5's pythonic wire, nothing here writes template text.
 */

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

/**
 * The caller's system message: the contract's core, then the attached files as the training rows carry them
 * (`"\n\nFiles available: "` + compact JSON of `{id, name, type}`). The tools are not in it: they go to the template.
 */
export function lfm3SystemPrompt(files: readonly SouffleurFileRef[] = []): string {
  if (!files.length) return LFM3_SYSTEM_CORE;
  return (
    LFM3_SYSTEM_CORE +
    '\n\nFiles available: ' +
    JSON.stringify(files.map(({ id, name, type }) => ({ id, name, type })))
  );
}

/** The contract's tools that are enabled, in the contract's order; a name the contract lacks is ignored. */
export function lfm3Tools(enabledToolNames: readonly string[]): Lfm3Tool[] {
  const enabled = new Set(enabledToolNames);
  return LFM3_TOOLS.filter((t) => enabled.has(t.function.name));
}

/**
 * The AparteClient history as chat messages: the system message first (a `system` entry of the history is
 * dropped, as on the LFM2.5 wire), an assistant turn with its calls (arguments as a JSON string, the OpenAI
 * shape), one `tool` message per result, answering its call by id.
 */
export function toChatMessages(
  systemPrompt: string,
  messages: readonly AparteChatMessage[],
): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        break;
      case 'user':
        out.push({ role: 'user', content: contentToText(m.content) });
        break;
      case 'assistant':
        out.push({
          role: 'assistant',
          content: contentToText(m.content),
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
              }
            : {}),
        });
        break;
      case 'tool':
        out.push({
          role: 'tool',
          content: contentToText(m.content),
          tool_call_id: m.toolCallId ?? '',
        });
        break;
    }
  }
  return out;
}

/**
 * A call's arguments as the engine received them, streamed as a JSON string. Cut by the token limit or not JSON:
 * null, so the provider drops the call rather than running a tool on half its input.
 */
export function parseCallArguments(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
