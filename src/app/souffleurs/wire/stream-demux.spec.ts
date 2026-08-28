import { describe, expect, it } from 'vitest';
import { WireStreamDemux, type DemuxEvent } from './stream-demux';

function collect(chunks: string[]): DemuxEvent[] {
  const d = new WireStreamDemux();
  const out: DemuxEvent[] = [];
  for (const c of chunks) out.push(...d.push(c));
  out.push(...d.flush());
  return out;
}

const text = (events: DemuxEvent[]) =>
  events
    .filter((e) => e.kind === 'text')
    .map((e) => e.delta)
    .join('');
const thinking = (events: DemuxEvent[]) =>
  events
    .filter((e) => e.kind === 'thinking')
    .map((e) => e.delta)
    .join('');

describe('WireStreamDemux', () => {
  it('lets simple text through', () => {
    expect(text(collect(['Bonjour', ' le monde']))).toBe('Bonjour le monde');
  });

  it('routes <think> to thinking', () => {
    const events = collect(['<think>réflexion</think>Réponse']);
    expect(thinking(events)).toBe('réflexion');
    expect(text(events)).toBe('Réponse');
  });

  it('swallows a whole tool_call block', () => {
    const events = collect(['Intro\n<|tool_call_start|>[compute(task="2+2")]<|tool_call_end|>']);
    expect(text(events)).toBe('Intro\n');
  });

  it('handles a marker split across several chunks', () => {
    const events = collect(['Voici.<|tool_', 'call_start|>[f(a=1)]<|tool_call', '_end|>Suite']);
    expect(text(events)).toBe('Voici.Suite');
  });

  it('stops at <|im_end|>', () => {
    const events = collect(['Fin.<|im_end|>', 'pollution après']);
    expect(text(events)).toBe('Fin.');
  });

  it('a lone < eventually gets emitted (flush)', () => {
    expect(text(collect(['valeur ', '<', ' seuil']))).toBe('valeur < seuil');
    expect(text(collect(['fin <']))).toBe('fin <');
  });

  it('a false start of a marker is rendered as text', () => {
    expect(text(collect(['<|tool_calc|>']))).toBe('<|tool_calc|>');
  });
});
