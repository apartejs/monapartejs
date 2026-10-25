/**
 * ExcelJS, loaded on demand (a deferred chunk, never in the initial bundle).
 *
 * The production build resolves `exceljs` to its UMD browser file, and the chunk
 * made of it exports only `default`: `const { Workbook } = await import('exceljs')`
 * is undefined there, while Node and the dev server add the named exports — so only
 * production broke. Every caller goes through this.
 */
import type { Workbook } from 'exceljs';

export async function loadWorkbook(): Promise<typeof Workbook> {
  const mod = (await import('exceljs')) as unknown as {
    default?: { Workbook: typeof Workbook };
    Workbook?: typeof Workbook;
  };
  // `default` first: present in every build; the named export only outside production.
  const exceljs = mod.default ?? mod;
  return exceljs.Workbook!;
}
