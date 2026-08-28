import { describe, expect, it } from 'vitest';
import { ProgressAggregator } from './progress-aggregator';

describe('ProgressAggregator', () => {
  it('agrège plusieurs fichiers avec plancher sur le total attendu', () => {
    const agg = new ProgressAggregator(1000);
    expect(agg.push({ file: 'a', loaded: 100, total: 200, done: false })).toBe(10);
    expect(agg.push({ file: 'b', loaded: 400, total: 800, done: false })).toBe(50);
  });

  it('un done SANS tailles ne fait JAMAIS retomber la progression (bug aimi/transformers)', () => {
    const agg = new ProgressAggregator(1000);
    agg.push({ file: 'config', loaded: 100, total: 100, done: false });
    const afterDone = agg.push({ file: 'config', loaded: 0, total: 0, done: true });
    expect(afterDone).toBe(10);
    // et un event tardif incohérent ne régresse pas non plus
    expect(agg.push({ file: 'config', loaded: 5, total: 100, done: false })).toBe(10);
  });

  it('done avec total connu = fichier acquis en entier', () => {
    const agg = new ProgressAggregator(1000);
    agg.push({ file: 'a', loaded: 300, total: 500, done: false });
    expect(agg.push({ file: 'a', loaded: 0, total: 0, done: true })).toBe(50);
  });

  it('monotone globalement, plafonné à 99 (le 100 = ready)', () => {
    const agg = new ProgressAggregator(100);
    agg.push({ file: 'a', loaded: 100, total: 100, done: true });
    expect(agg.push({ file: 'b', loaded: 50, total: 50, done: true })).toBe(99);
  });
});
