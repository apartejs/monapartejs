import { describe, expect, it } from 'vitest';
import type { AparteToolCallSegment } from '@aparte/core';
import { readFileRenderer } from './tool-renderers';

const segment = (result: Record<string, unknown>) =>
  ({
    id: 's1',
    type: 'tool-call',
    status: 'done',
    result: JSON.stringify(result),
  }) as unknown as AparteToolCallSegment;

describe('readFileRenderer', () => {
  it('shows an image read as one tool line, without the description', () => {
    const html = readFileRenderer.render(
      segment({
        ok: true,
        name: 'og-card.png',
        description: 'A dark card with the word Monaparté.',
        width: 1200,
        height: 630,
      }),
    ) as string;
    expect(html).toContain('bp-tool-line');
    expect(html).toContain('og-card.png');
    expect(html).not.toContain('Monaparté');
    expect(html).not.toContain('bp-artifact-card');
  });

  it('still shows a failed read with its error', () => {
    const html = readFileRenderer.render(
      segment({ ok: false, error: 'file_id inconnu' }),
    ) as string;
    expect(html).toContain('file_id inconnu');
  });
});
