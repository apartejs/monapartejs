/**
 * Démultiplexeur du flux de tokens décodés (skip_special_tokens:false) :
 * route le texte vers l'UI, les blocs <think> vers les events "thinking",
 * avale les blocs <|tool_call_start|>…<|tool_call_end|> (parsés en fin de tour
 * sur le texte brut complet) et s'arrête à <|im_end|>.
 * Robuste aux marqueurs coupés à cheval sur deux chunks (hold-back du plus
 * long suffixe qui est préfixe d'un marqueur).
 */

export interface DemuxEvent {
  kind: 'text' | 'thinking';
  delta: string;
}

type Mode = 'text' | 'thinking' | 'tool' | 'ended';

const MARKERS = [
  '<think>',
  '</think>',
  '<|tool_call_start|>',
  '<|tool_call_end|>',
  '<|im_end|>',
] as const;

export class WireStreamDemux {
  private mode: Mode = 'text';
  private pending = '';

  push(delta: string): DemuxEvent[] {
    if (this.mode === 'ended') return [];
    this.pending += delta;
    const events: DemuxEvent[] = [];

    for (;;) {
      const hit = this.earliestMarker();
      if (!hit) break;
      this.emit(this.pending.slice(0, hit.index), events);
      this.pending = this.pending.slice(hit.index + hit.marker.length);
      switch (hit.marker) {
        case '<think>':
          this.mode = 'thinking';
          break;
        case '</think>':
          this.mode = 'text';
          break;
        case '<|tool_call_start|>':
          this.mode = 'tool';
          break;
        case '<|tool_call_end|>':
          this.mode = 'text';
          break;
        case '<|im_end|>':
          this.mode = 'ended';
          this.pending = '';
          return events;
      }
    }

    const hold = this.holdbackLength();
    if (this.pending.length > hold) {
      this.emit(this.pending.slice(0, this.pending.length - hold), events);
      this.pending = this.pending.slice(this.pending.length - hold);
    }
    return events;
  }

  /** Fin de génération : vide ce qui reste (un préfixe de marqueur jamais complété est du texte). */
  flush(): DemuxEvent[] {
    const events: DemuxEvent[] = [];
    if (this.mode !== 'ended') {
      this.emit(this.pending, events);
    }
    this.pending = '';
    return events;
  }

  private emit(chunk: string, into: DemuxEvent[]): void {
    if (!chunk) return;
    if (this.mode === 'text') into.push({ kind: 'text', delta: chunk });
    else if (this.mode === 'thinking') into.push({ kind: 'thinking', delta: chunk });
    // mode 'tool' : avalé (le bloc complet est reparsé en fin de tour)
  }

  private earliestMarker(): { index: number; marker: string } | null {
    let best: { index: number; marker: string } | null = null;
    for (const marker of MARKERS) {
      const index = this.pending.indexOf(marker);
      if (index !== -1 && (best === null || index < best.index)) {
        best = { index, marker };
      }
    }
    return best;
  }

  private holdbackLength(): number {
    const max = Math.min(this.pending.length, Math.max(...MARKERS.map((m) => m.length)) - 1);
    for (let len = max; len > 0; len--) {
      const suffix = this.pending.slice(this.pending.length - len);
      if (MARKERS.some((m) => m.startsWith(suffix))) return len;
    }
    return 0;
  }
}
