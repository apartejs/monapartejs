import { describe, expect, it } from 'vitest';
import type { AparteChatMessage } from '@aparte/core';
import { buildWirePrompt, renderToolCallBlock } from './prompt-builder';

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
  it('reproduces the exact wire structure: multi-turn with tool_call and tool_result', () => {
    const toolResult = JSON.stringify({ ok: true, type: 'read_file', mime: 'xlsx' }, null, 2);
    const messages: AparteChatMessage[] = [
      { role: 'user', content: 'Résume ce fichier' },
      {
        role: 'tool_call',
        content: '',
        precedingText: 'Je consulte votre fichier.',
        toolCalls: [{ id: 't1', name: 'read_file', input: { file_id: 'file_m_4' } }],
      },
      { role: 'tool_result', content: toolResult, toolCallId: 't1' },
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

  it('tool_call with no intro text: block alone in the assistant turn', () => {
    const wire = buildWirePrompt('SYS', [
      {
        role: 'tool_call',
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
