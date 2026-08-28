import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './system-prompt';
import { SOUFFLEUR_TOOL_DEFS, SOUFFLEUR_TOOL_NAMES } from './tool-defs';

describe('buildSystemPrompt', () => {
  it('substitue {{assistant}} et commence par le corps sp-chat', () => {
    const s = buildSystemPrompt([]);
    expect(s.startsWith("Tu es l'assistant, un assistant personnel")).toBe(true);
    expect(s).not.toContain('{{assistant}}');
  });

  it('avec les 9 outils : bloc List of tools identique au JSON du contrat', () => {
    const s = buildSystemPrompt(SOUFFLEUR_TOOL_NAMES);
    const expected = '\n\nList of tools: ' + JSON.stringify(SOUFFLEUR_TOOL_DEFS);
    expect(s).toContain(expected);
    // (les descriptions d'outils citent « Files available » — on vérifie
    // l'absence du BLOC, pas de la chaîne)
    expect(s).not.toContain('\n\nFiles available: ');
  });

  it('sous-ensemble : ordre du contrat, pas ordre d’activation', () => {
    const s = buildSystemPrompt(['ask_question', 'read_file']);
    const block = s.split('List of tools: ')[1];
    const tools = JSON.parse(block) as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(['read_file', 'ask_question']);
  });

  it('nom inconnu ignoré, zéro outil → pas de bloc tools', () => {
    const s = buildSystemPrompt(['inconnu']);
    expect(s).not.toContain('List of tools');
  });

  it('bloc Files available au format [{id,name,type}], clés dans cet ordre', () => {
    const s = buildSystemPrompt(
      ['read_file'],
      [{ id: 'file_x_1', name: 'rapport.pdf', type: 'pdf' }],
    );
    expect(s).toContain(
      '\n\nFiles available: [{"id":"file_x_1","name":"rapport.pdf","type":"pdf"}]',
    );
  });

  it('nom d’assistant configurable', () => {
    const s = buildSystemPrompt([], [], 'monaparte');
    expect(s.startsWith('Tu es monaparte,')).toBe(true);
  });
});
