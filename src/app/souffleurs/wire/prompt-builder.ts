import { contentToText } from '@aparte/core';
import type { AparteChatMessage, AparteToolCall } from '@aparte/core';

/**
 * Construction du prompt « wire » LFM2.5 — port TS du template d'entraînement
 * lfm25-chat-1.0.0.jinja. Le chat_template embarqué dans le repo HF ignore
 * message.tool_calls (KO multi-tour) : on n'utilise JAMAIS apply_chat_template,
 * on assemble le texte exact vu à l'entraînement.
 */

const IM_START = '<|im_start|>';
const IM_END = '<|im_end|>';

function wireTurn(role: string, content: string): string {
  return `${IM_START}${role}\n${content}\n${IM_END}\n`;
}

/**
 * Rend un bloc d'appels pythonic : valeurs de kwargs sérialisées en JSON
 * ({{ v | tojson }} du template), appels multiples séparés par ", ".
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
 * messages = l'historique AparteChatMessage tel que fourni par AparteClient
 * (rôles user/assistant/tool_call/tool_result). Le prompt système est fourni
 * séparément — un éventuel role 'system' dans l'historique est ignoré.
 * Se termine par le generation prompt `<|im_start|>assistant\n`.
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
      case 'assistant':
        out += wireTurn('assistant', contentToText(m.content));
        break;
      case 'tool_call': {
        const intro = (m.precedingText ?? contentToText(m.content)).trim();
        const block = renderToolCallBlock(m.toolCalls ?? []);
        out += wireTurn('assistant', intro ? `${intro}\n${block}` : block);
        break;
      }
      case 'tool_result':
        out += wireTurn('tool', contentToText(m.content));
        break;
    }
  }

  return out + `${IM_START}assistant\n`;
}
