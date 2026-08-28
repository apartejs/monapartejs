/**
 * Multi-file progress aggregation (base + adapter + config/tokenizer).
 * Lessons from the field:
 *  - transformers.js emits events per file, and `done` often arrives WITHOUT
 *    loaded/total → a completed file must stay acquired, never fall back;
 *  - the overall percentage must be MONOTONIC (never decreasing);
 *  - floor denominator = total expected size, to stay honest before all
 *    files have announced their size.
 */

export interface FileProgressEvent {
  file: string;
  loaded: number;
  total: number;
  done: boolean;
}

export class ProgressAggregator {
  private readonly files = new Map<string, { loaded: number; total: number }>();
  private last = 0;

  constructor(private readonly expectedTotalBytes: number) {}

  /** Integrates an event and returns the overall percentage (0-99, monotonic). */
  push(event: FileProgressEvent): number {
    const prev = this.files.get(event.file) ?? { loaded: 0, total: 0 };
    const total = Math.max(prev.total, event.total || 0);
    let loaded = Math.max(prev.loaded, event.loaded || 0);
    if (event.done) loaded = Math.max(loaded, total);
    this.files.set(event.file, { loaded, total });

    let sumLoaded = 0;
    let sumTotal = 0;
    for (const f of this.files.values()) {
      sumLoaded += f.loaded;
      sumTotal += f.total;
    }
    const denominator = Math.max(sumTotal, this.expectedTotalBytes);
    const progress = Math.min(99, Math.floor((sumLoaded / denominator) * 100));
    this.last = Math.max(this.last, progress);
    return this.last;
  }
}
