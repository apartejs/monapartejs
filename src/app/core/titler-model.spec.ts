import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_FILE } from './titler-model';

const require = createRequire(import.meta.url);

describe('the titler model', () => {
  it('is the file the package ships — a renamed model would 404 and titles fall back to truncation, silently', () => {
    // scripts/copy-titler-model.mjs copies `@aparte/titler-efigsp/model` under its own name;
    // the service asks for MODEL_FILE. A version bump renames the file (1.2: titler-v1.2-…).
    expect(MODEL_FILE).toBe(basename(require.resolve('@aparte/titler-efigsp/model')));
  });

  it('titles a French message with words of that message', async () => {
    const { loadTitler } = await import('@aparte/titler-efigsp');
    const bytes = readFileSync(require.resolve('@aparte/titler-efigsp/model'));
    const titler = await loadTitler(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const message =
      'Peux-tu me préparer une facture pour la rénovation de la cuisine de Mme Leroy ?';
    const title = titler.title(message).trim();
    expect(title.length).toBeGreaterThan(0);
    for (const word of title.split(/\s+/))
      expect(message.toLowerCase()).toContain(word.toLowerCase());
  });
});
