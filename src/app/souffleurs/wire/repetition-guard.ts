/**
 * Degeneration guard for a greedy decode.
 *
 * Seen in the browser on 2026-08-28: souffleur-pdf answered a "create the
 * invoice" task with the same French sentence ("Je vais mettre 0 pour le
 * total HT si c'est la première ligne de…") repeated line after line, until
 * `EXECUTOR_MAX_NEW_TOKENS` (12 000) — minutes of GPU for garbage, and the
 * conversation's Stop button did not reach the executor. Greedy decoding has
 * no way out of such a cycle by itself: once the model repeats a line it will
 * repeat it forever. Cutting it short costs nothing — no valid output ever
 * contains the same long line four times in a row.
 *
 * Pure and incremental: feed every delta, ask `tripped` after each. Lives
 * outside the worker so it can be unit-tested.
 */
export class RepetitionGuard {
  private tail = '';
  private readonly lines: string[] = [];
  private _tripped = false;

  /**
   * @param maxRepeats identical consecutive lines that trip the guard
   * @param minLength lines shorter than this are ignored (blank lines, `}`,
   *   list bullets — those legitimately repeat)
   */
  constructor(
    private readonly maxRepeats = 4,
    private readonly minLength = 12,
  ) {}

  push(delta: string): void {
    if (this._tripped) return;
    this.tail += delta;
    let nl = this.tail.indexOf('\n');
    while (nl !== -1) {
      const line = this.tail.slice(0, nl).trim();
      this.tail = this.tail.slice(nl + 1);
      this.lines.push(line);
      if (this.lines.length > this.maxRepeats) this.lines.shift();
      if (
        line.length >= this.minLength &&
        this.lines.length === this.maxRepeats &&
        this.lines.every((l) => l === line)
      ) {
        this._tripped = true;
        return;
      }
      nl = this.tail.indexOf('\n');
    }
  }

  get tripped(): boolean {
    return this._tripped;
  }
}
