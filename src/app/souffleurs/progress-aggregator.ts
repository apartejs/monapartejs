/**
 * Agrégation de progression multi-fichiers (base + adapter + config/tokenizer).
 * Leçons du terrain :
 *  - transformers.js émet des events par fichier, et le `done` arrive souvent
 *    SANS loaded/total → un fichier terminé doit rester acquis, jamais retomber ;
 *  - le pourcentage global doit être MONOTONE (jamais décroissant) ;
 *  - dénominateur plancher = taille attendue totale, pour rester honnête avant
 *    que tous les fichiers n'aient annoncé leur taille.
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

  /** Intègre un événement et renvoie le pourcentage global (0-99, monotone). */
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
