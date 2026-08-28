/**
 * La mascotte aparté — un visage en pure ponctuation, jamais un asset.
 * Parenthèses = le visage (l'aparté lui-même), apostrophes = les yeux,
 * point = nez/bouche. États issus de l'étude d'identité.
 */

export type MascotteState =
  'idle' | 'thinking' | 'talking' | 'happy' | 'error' | 'sleeping' | 'wake';

export interface MascotteFace {
  eyeLeft: string;
  nose: string;
  eyeRight: string;
  /** Suffixe hors parenthèses (…, caret ▌ géré en CSS). */
  suffix?: 'dots' | 'caret';
}

export const MASCOTTE_FACES: Record<MascotteState, MascotteFace> = {
  idle: { eyeLeft: '’', nose: '.', eyeRight: '’' },
  thinking: { eyeLeft: '’', nose: '.', eyeRight: '’', suffix: 'dots' },
  talking: { eyeLeft: '’', nose: 'o', eyeRight: '’', suffix: 'caret' },
  happy: { eyeLeft: '^', nose: '.', eyeRight: '^' },
  error: { eyeLeft: 'x', nose: '.', eyeRight: 'x' },
  sleeping: { eyeLeft: '-', nose: '.', eyeRight: '-' },
  wake: { eyeLeft: '’', nose: 'o', eyeRight: '’' },
};

/** Représentation texte brute, ex. ('.') — pour titres, favicon, logs. */
export function mascotteText(state: MascotteState = 'idle'): string {
  const f = MASCOTTE_FACES[state];
  return `(${f.eyeLeft === '’' ? "'" : f.eyeLeft}${f.nose}${f.eyeRight === '’' ? "'" : f.eyeRight})`;
}
