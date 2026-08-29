/**
 * The aparté mascot — a face made of pure punctuation, never an asset.
 * Parentheses = the face (the aparté itself), apostrophes = the eyes,
 * period = nose/mouth. States drawn from the identity study; `surprised`
 * and `searching` are the interactive ones (hover, and a cursor gone quiet).
 *
 * The glyphs are chosen for their width as much as their look: inside the
 * house (mark.ts) the face has 2.5 em of room, and Georgia's `^` is 0.64 em
 * wide, `o` 0.54, against 0.22 for the apostrophe. So the happy eyes are the
 * modifier circumflex `ˆ` (0.5 em, and it sits high, like eyes closed by a
 * smile), the surprised ones the degree sign `°` (0.42 em, two small rounds).
 * The straight apostrophe, not the curly `’`: it is what the icons draw.
 */

export type MascotteState =
  | 'idle'
  | 'thinking'
  | 'talking'
  | 'happy'
  | 'error'
  | 'sleeping'
  | 'wake'
  | 'surprised'
  | 'searching';

export interface MascotteFace {
  eyeLeft: string;
  nose: string;
  eyeRight: string;
  /** Suffix outside the parentheses (…, caret ▌ handled in CSS). */
  suffix?: 'dots' | 'caret';
}

export const MASCOTTE_FACES: Record<MascotteState, MascotteFace> = {
  idle: { eyeLeft: "'", nose: '.', eyeRight: "'" },
  thinking: { eyeLeft: "'", nose: '.', eyeRight: "'", suffix: 'dots' },
  talking: { eyeLeft: "'", nose: 'o', eyeRight: "'", suffix: 'caret' },
  happy: { eyeLeft: 'ˆ', nose: '.', eyeRight: 'ˆ' },
  error: { eyeLeft: 'x', nose: '.', eyeRight: 'x' },
  sleeping: { eyeLeft: '-', nose: '.', eyeRight: '-' },
  wake: { eyeLeft: "'", nose: 'o', eyeRight: "'" },
  surprised: { eyeLeft: '°', nose: '.', eyeRight: '°' },
  searching: { eyeLeft: "'", nose: '.', eyeRight: "'" },
};

/** Raw text representation, e.g. ('.') — for titles, favicon, logs. */
export function mascotteText(state: MascotteState = 'idle'): string {
  const f = MASCOTTE_FACES[state];
  return `(${f.eyeLeft}${f.nose}${f.eyeRight})`;
}
