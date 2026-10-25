import { contentToText } from '@aparte/core';
import type { AparteChatMessage, AparteToolCall } from '@aparte/core';

/**
 * Building the LFM2.5 "wire" prompt — TS port of the lfm25-chat-1.0.0.jinja
 * training template. The chat_template embedded in the HF repo ignores
 * message.tool_calls (broken multi-turn): we NEVER use apply_chat_template,
 * we assemble the exact text seen at training time.
 */

const IM_START = '<|im_start|>';
const IM_END = '<|im_end|>';

function wireTurn(role: string, content: string): string {
  return `${IM_START}${role}\n${content}\n${IM_END}\n`;
}

/**
 * Renders a block of pythonic calls: kwarg values serialized as JSON
 * ({{ v | tojson }} from the template), multiple calls separated by ", ".
 */
export function renderToolCallBlock(calls: readonly AparteToolCall[]): string {
  const rendered = calls
    .map(
      (c) =>
        `${c.name}(${Object.entries(c.input)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ')})`,
    )
    .join(', ');
  return `<|tool_call_start|>[${rendered}]<|tool_call_end|>`;
}

/**
 * The exact start of every `buildWirePrompt(systemPrompt, …)`, through the end of the
 * system text. A "Files available" block only appends to the system text, so this prefix
 * holds with or without attached files: it is what the engine prefills ahead of time and
 * what llama.cpp's prompt cache then reuses.
 */
export function wirePrefix(systemPrompt: string): string {
  return `<|startoftext|>${IM_START}system\n${systemPrompt}`;
}

/**
 * messages = the AparteChatMessage history as provided by AparteClient: a tool
 * round trip is an `assistant` message carrying `toolCalls` (its `content` is what
 * was said before them) followed by one `tool` message per result — earlier turns'
 * included, as the training template renders them. The system prompt is provided
 * separately — any 'system' role in the history is ignored.
 * Ends with the generation prompt `<|im_start|>assistant\n`.
 */
export function buildWirePrompt(
  systemPrompt: string,
  messages: readonly AparteChatMessage[],
): string {
  let out = '<|startoftext|>' + wireTurn('system', systemPrompt);

  for (const m of messages) {
    switch (m.role) {
      case 'system':
        break;
      case 'user':
        out += wireTurn('user', contentToText(m.content));
        break;
      case 'assistant': {
        if (!m.toolCalls?.length) {
          out += wireTurn('assistant', contentToText(m.content));
          break;
        }
        const intro = contentToText(m.content).trim();
        const block = renderToolCallBlock(m.toolCalls);
        out += wireTurn('assistant', intro ? `${intro}\n${block}` : block);
        break;
      }
      case 'tool':
        out += wireTurn('tool', contentToText(m.content));
        break;
    }
  }

  return out + `${IM_START}assistant\n`;
}
