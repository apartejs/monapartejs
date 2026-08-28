/**
 * The aparté mascot — a face made of pure punctuation, never an asset.
 * Parentheses = the face (the aparté itself), apostrophes = the eyes,
 * period = nose/mouth. States drawn from the identity study.
 */

export type MascotteState =
  'idle' | 'thinking' | 'talking' | 'happy' | 'error' | 'sleeping' | 'wake';

export interface MascotteFace {
  eyeLeft: string;
  nose: string;
  eyeRight: string;
  /** Suffix outside the parentheses (…, caret ▌ handled in CSS). */
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

/** Raw text representation, e.g. ('.') — for titles, favicon, logs. */
export function mascotteText(state: MascotteState = 'idle'): string {
  const f = MASCOTTE_FACES[state];
  return `(${f.eyeLeft === '’' ? "'" : f.eyeLeft}${f.nose}${f.eyeRight === '’' ? "'" : f.eyeRight})`;
}
