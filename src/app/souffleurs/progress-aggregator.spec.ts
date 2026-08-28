import { describe, expect, it } from 'vitest';
import { ProgressAggregator } from './progress-aggregator';

describe('ProgressAggregator', () => {
  it('aggregates several files with a floor on the total expected', () => {
    const agg = new ProgressAggregator(1000);
    expect(agg.push({ file: 'a', loaded: 100, total: 200, done: false })).toBe(10);
    expect(agg.push({ file: 'b', loaded: 400, total: 800, done: false })).toBe(50);
  });

  it('a done WITHOUT sizes NEVER makes progress fall back (aimi/transformers bug)', () => {
    const agg = new ProgressAggregator(1000);
    agg.push({ file: 'config', loaded: 100, total: 100, done: false });
    const afterDone = agg.push({ file: 'config', loaded: 0, total: 0, done: true });
    expect(afterDone).toBe(10);
    // and a late inconsistent event doesn't regress either
    expect(agg.push({ file: 'config', loaded: 5, total: 100, done: false })).toBe(10);
  });

  it('done with known total = file fully acquired', () => {
    const agg = new ProgressAggregator(1000);
    agg.push({ file: 'a', loaded: 300, total: 500, done: false });
    expect(agg.push({ file: 'a', loaded: 0, total: 0, done: true })).toBe(50);
  });

  it('globally monotonic, capped at 99 (100 = ready)', () => {
    const agg = new ProgressAggregator(100);
    agg.push({ file: 'a', loaded: 100, total: 100, done: true });
    expect(agg.push({ file: 'b', loaded: 50, total: 50, done: true })).toBe(99);
  });
});
