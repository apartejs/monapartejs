import { describe, expect, it } from 'vitest';
import type { AparteChatMessage } from '@aparte/core';
import { buildWirePrompt, renderToolCallBlock, wirePrefix } from './prompt-builder';
import { buildSystemPrompt } from './system-prompt';
import { SOUFFLEUR_TOOL_NAMES } from './tool-defs';

describe('renderToolCallBlock', () => {
  it('serializes kwargs as JSON, pythonic syntax', () => {
    expect(
      renderToolCallBlock([{ id: '1', name: 'read_file', input: { file_id: 'file_a_1' } }]),
    ).toBe('<|tool_call_start|>[read_file(file_id="file_a_1")]<|tool_call_end|>');
  });

  it('list as a value + multiple calls separated by ", "', () => {
    expect(
      renderToolCallBlock([
        { id: '1', name: 'write_file', input: { kind: 'xlsx', file_ids: ['a', 'b'] } },
        { id: '2', name: 'compute', input: { task: '2+2' } },
      ]),
    ).toBe(
      '<|tool_call_start|>[write_file(kind="xlsx", file_ids=["a","b"]), compute(task="2+2")]<|tool_call_end|>',
    );
  });
});

describe('buildWirePrompt — golden training format (lfm25-chat-1.0.0)', () => {
  it('reproduces the exact wire structure: multi-turn with a tool call and its result', () => {
    const toolResult = JSON.stringify({ ok: true, type: 'read_file', mime: 'xlsx' }, null, 2);
    const messages: AparteChatMessage[] = [
      { role: 'user', content: 'Résume ce fichier' },
      // aparté ≥ 0.17: the call rides on the assistant message, `content` is what it said first.
      {
        role: 'assistant',
        content: 'Je consulte votre fichier.',
        toolCalls: [{ id: 't1', name: 'read_file', input: { file_id: 'file_m_4' } }],
      },
      { role: 'tool', content: toolResult, toolCallId: 't1', toolName: 'read_file' },
      { role: 'assistant', content: 'Voici le résumé.\n\nAutre chose ?' },
      { role: 'user', content: 'Non merci !' },
    ];

    const expected =
      '<|startoftext|>' +
      '<|im_start|>system\nSYS\n<|im_end|>\n' +
      '<|im_start|>user\nRésume ce fichier\n<|im_end|>\n' +
      '<|im_start|>assistant\nJe consulte votre fichier.\n' +
      '<|tool_call_start|>[read_file(file_id="file_m_4")]<|tool_call_end|>\n<|im_end|>\n' +
      '<|im_start|>tool\n' +
      toolResult +
      '\n<|im_end|>\n' +
      '<|im_start|>assistant\nVoici le résumé.\n\nAutre chose ?\n<|im_end|>\n' +
      '<|im_start|>user\nNon merci !\n<|im_end|>\n' +
      '<|im_start|>assistant\n';

    expect(buildWirePrompt('SYS', messages)).toBe(expected);
  });

  it('a tool call with no intro text: block alone in the assistant turn', () => {
    const wire = buildWirePrompt('SYS', [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: '1', name: 'compute', input: { task: '2+2' } }],
      },
    ]);
    expect(wire).toContain(
      '<|im_start|>assistant\n<|tool_call_start|>[compute(task="2+2")]<|tool_call_end|>\n<|im_end|>\n',
    );
  });

  it('ignores a system role in the history (the system is provided separately)', () => {
    const wire = buildWirePrompt('SYS', [
      { role: 'system', content: 'PIRATE' },
      { role: 'user', content: 'Salut' },
    ]);
    expect(wire).not.toContain('PIRATE');
    expect(wire.split('<|im_start|>').length).toBe(4); // system + user + generation prompt
  });

  it('multimodal content parts reduced to text', () => {
    const wire = buildWirePrompt('SYS', [
      { role: 'user', content: [{ type: 'text', text: 'Bonjour' }] },
    ]);
    expect(wire).toContain('<|im_start|>user\nBonjour\n<|im_end|>\n');
  });
});

describe('wirePrefix', () => {
  const tools = [...SOUFFLEUR_TOOL_NAMES];
  const system = buildSystemPrompt(tools);
  const withFile = buildSystemPrompt(tools, [{ id: 'file_a_1', name: 'a.xlsx', type: 'xlsx' }]);
  const one: AparteChatMessage[] = [{ role: 'user', content: 'Bonjour' }];
  const three: AparteChatMessage[] = [
    { role: 'user', content: 'Bonjour' },
    { role: 'assistant', content: 'Bonjour !' },
    { role: 'user', content: 'Et ce fichier ?' },
  ];

  it('is a prefix of every wire prompt for that system, with or without files', () => {
    for (const messages of [one, three]) {
      expect(buildWirePrompt(system, messages).startsWith(wirePrefix(system))).toBe(true);
      expect(buildWirePrompt(withFile, messages).startsWith(wirePrefix(system))).toBe(true);
    }
  });

  it('ends with the system text itself, before any closing marker', () => {
    expect(wirePrefix(system).endsWith(system)).toBe(true);
  });
});
