/**
 * Regression: every .xlsx failed in production with "t is not a constructor".
 *
 * The production build resolves `exceljs` to its UMD browser file, and the chunk
 * esbuild makes of it exports only `default` (measured on mon.apartejs.dev: the
 * chunk's namespace is `{ default }`). `const { Workbook } = await import('exceljs')`
 * is then undefined. Node and the dev server add the named exports, so neither the
 * tests nor `pnpm start` ever saw it. The mock below gives the real ExcelJS in the
 * production shape.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('exceljs', async () => {
  const real = (await vi.importActual('exceljs')) as { default?: unknown };
  return { default: real.default ?? real };
});

const { applyXlsxOps } = await import('./xlsx-ops-runtime');
const { surveyXlsx } = await import('../tools/read-file.tool');

// The ops souffleur-xlsx-docx emitted on the M5 for "un tableau Excel de suivi de dépenses".
const OPS = [
  { op: 'addWorksheet', name: 'Dépenses' },
  { op: 'addRow', values: ['Date', 'Catégorie', 'Montant'] },
];

describe('ExcelJS exposed only as a default export (the production chunk)', () => {
  it('a workbook is built from the ops', async () => {
    const { bytes } = await applyXlsxOps(OPS);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('an attached workbook can be read', async () => {
    const { bytes } = await applyXlsxOps(OPS);
    const survey = await surveyXlsx(new Blob([bytes]));
    expect(JSON.stringify(survey)).toContain('Dépenses');
  });
});
