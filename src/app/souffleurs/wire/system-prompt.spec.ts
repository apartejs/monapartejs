import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './system-prompt';
import { SOUFFLEUR_TOOL_DEFS, SOUFFLEUR_TOOL_NAMES } from './tool-defs';

describe('buildSystemPrompt', () => {
  it('substitutes {{assistant}} and starts with the sp-chat body', () => {
    const s = buildSystemPrompt([]);
    expect(s.startsWith("Tu es l'assistant, un assistant personnel")).toBe(true);
    expect(s).not.toContain('{{assistant}}');
  });

  it('with all 9 tools: List of tools block identical to the contract JSON', () => {
    const s = buildSystemPrompt(SOUFFLEUR_TOOL_NAMES);
    const expected = '\n\nList of tools: ' + JSON.stringify(SOUFFLEUR_TOOL_DEFS);
    expect(s).toContain(expected);
    // (tool descriptions mention "Files available" — we check for the
    // absence of the BLOCK, not the string)
    expect(s).not.toContain('\n\nFiles available: ');
  });

  it('subset: contract order, not activation order', () => {
    const s = buildSystemPrompt(['ask_question', 'read_file']);
    const block = s.split('List of tools: ')[1];
    const tools = JSON.parse(block) as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(['read_file', 'ask_question']);
  });

  it('unknown name ignored, zero tools → no tools block', () => {
    const s = buildSystemPrompt(['inconnu']);
    expect(s).not.toContain('List of tools');
  });

  it('Files available block in [{id,name,type}] format, keys in this order', () => {
    const s = buildSystemPrompt(
      ['read_file'],
      [{ id: 'file_x_1', name: 'rapport.pdf', type: 'pdf' }],
    );
    expect(s).toContain(
      '\n\nFiles available: [{"id":"file_x_1","name":"rapport.pdf","type":"pdf"}]',
    );
  });

  it('configurable assistant name', () => {
    const s = buildSystemPrompt([], [], 'monaparte');
    expect(s.startsWith('Tu es monaparte,')).toBe(true);
  });
});
