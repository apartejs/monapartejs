import { describe, expect, it } from 'vitest';
import type { AparteChatMessage } from '@aparte/core';
import { lfm3SystemPrompt, lfm3Tools, parseCallArguments, toChatMessages } from './chat-wire';
import { LFM3_SYSTEM_CORE, LFM3_TOOLS } from './contract-lfm3';

describe('lfm3SystemPrompt', () => {
  it('is the contract core alone without files', () => {
    expect(lfm3SystemPrompt()).toBe(LFM3_SYSTEM_CORE);
  });

  it('appends the files as the training rows carry them', () => {
    const s = lfm3SystemPrompt([{ id: 'file_a1', name: 'devis.pdf', type: 'pdf' }]);
    expect(s).toBe(
      LFM3_SYSTEM_CORE + '\n\nFiles available: [{"id":"file_a1","name":"devis.pdf","type":"pdf"}]',
    );
  });
});

describe('lfm3Tools', () => {
  it('keeps the contract order and ignores names it lacks', () => {
    const tools = lfm3Tools(['compute', 'write_file', 'render']);
    expect(tools.map((t) => t.function.name)).toEqual(['render', 'compute']);
  });

  it('sends the contract text untouched', () => {
    expect(lfm3Tools(['render'])[0]).toBe(LFM3_TOOLS.find((t) => t.function.name === 'render'));
  });
});

describe('toChatMessages', () => {
  it('puts the system first, drops a history system entry, keeps calls and results by id', () => {
    const history: AparteChatMessage[] = [
      { role: 'system', content: 'ignored' },
      { role: 'user', content: 'Combien font 17 % de 2 340 € ?' },
      {
        role: 'assistant',
        content: 'Je calcule ça.',
        toolCalls: [{ id: 'c1', name: 'compute', input: { expression: '2340 * 17 / 100' } }],
      },
      { role: 'tool', content: '{"result":397.8}', toolCallId: 'c1' },
      { role: 'assistant', content: '17 % de 2 340 € font 397,80 €.' },
    ];
    expect(toChatMessages('SYS', history)).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'Combien font 17 % de 2 340 € ?' },
      {
        role: 'assistant',
        content: 'Je calcule ça.',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'compute', arguments: '{"expression":"2340 * 17 / 100"}' },
          },
        ],
      },
      { role: 'tool', content: '{"result":397.8}', tool_call_id: 'c1' },
      { role: 'assistant', content: '17 % de 2 340 € font 397,80 €.' },
    ]);
  });
});

describe('parseCallArguments', () => {
  it('reads the streamed JSON', () => {
    expect(parseCallArguments('{"kind":"pdf","task":"Facture"}')).toEqual({
      kind: 'pdf',
      task: 'Facture',
    });
  });

  it('refuses arguments cut mid-way or not an object', () => {
    expect(parseCallArguments('{"kind":"pdf","task":"Fact')).toBeNull();
    expect(parseCallArguments('[1,2]')).toBeNull();
  });

  it('takes no arguments as an empty object', () => {
    expect(parseCallArguments('')).toEqual({});
  });
});
