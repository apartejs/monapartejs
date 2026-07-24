/**
 * xlsx-ops-runtime.ts — executes le souffleur-xlsx-docx's declarative JSON ops.
 *
 * The xlsx-docx aimini does NOT emit JS code (unlike V0.1's sandbox-js). It emits
 * a JSON array of declarative ops ({op:"addWorksheet"}, {op:"fillRange", generator},
 * {op:"applyFormula"}, …) targeting the "xlsx-kit" runtime. This module IS that
 * runtime — a faithful port of executor.js du lab (v6, exécuteurs réutilisés tels quels en v7)
 * (applyXlsxOps + helpers), backed by ExcelJS.
 *
 * Generators (fillRange) use a LIGHTWEIGHT faker (the ~15 methods the aiminis
 * actually emit) instead of pulling in the 5 MB @faker-js/faker — keeps the
 * offline-first bundle lean.
 */
// ExcelJS est chargé dynamiquement (chunk différé — jamais dans le bundle initial).

export type XlsxOp = Record<string, unknown>;

// ── lightweight faker (only the methods the xlsx-docx aimini emits) ──────────
const FR_FIRST = ['Marie', 'Jean', 'Pierre', 'Sophie', 'Luc', 'Camille', 'Thomas', 'Julie', 'Nicolas', 'Léa', 'Paul', 'Emma', 'Hugo', 'Chloé', 'Louis', 'Manon'];
const FR_LAST = ['Martin', 'Bernard', 'Dubois', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Garnier', 'Roux', 'Fontaine', 'Girard'];
const FR_CITY = ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Bordeaux', 'Lille', 'Rennes', 'Montpellier', 'Grenoble', 'Dijon'];
const COMPANY = ['Solveris', 'NordTech', 'Atelier Léman', 'Cabinet Vidal', 'Groupe Belair', 'Studio Margaux', 'Eurodis', 'Novalink'];
const PRODUCT = ['Conseil', 'Développement', 'Formation', 'Maintenance', 'Audit', 'Design', 'Hébergement', 'Licence', 'Support'];
const rint = (min: number, max: number) => Math.floor(min + Math.random() * (max - min + 1));
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const pad2 = (n: number) => String(n).padStart(2, '0');

const FAKER_ALIASES: Record<string, string> = {
    'name.lastName': 'person.lastName', 'name.firstName': 'person.firstName', 'name.fullName': 'person.fullName',
    'address.city': 'location.city', 'address.zipCode': 'location.zipCode', 'address.streetAddress': 'location.streetAddress',
    'phone.phoneNumber': 'phone.number', 'random.number': 'number.int', 'random.float': 'number.float',
    'company.companyName': 'company.name', 'datatype.number': 'number.int',
};

function fakerValue(path: string, opts: Record<string, number | string>): string | number {
    const p = FAKER_ALIASES[path] || path;
    switch (p) {
        case 'person.firstName': return pick(FR_FIRST);
        case 'person.lastName': return pick(FR_LAST);
        case 'person.fullName': return `${pick(FR_FIRST)} ${pick(FR_LAST)}`;
        case 'internet.email': return `${pick(FR_FIRST).toLowerCase()}.${pick(FR_LAST).toLowerCase()}@example.com`;
        case 'internet.username': return `${pick(FR_FIRST).toLowerCase()}${rint(1, 99)}`;
        case 'phone.number': return `0${rint(6, 7)} ${pad2(rint(0, 99))} ${pad2(rint(0, 99))} ${pad2(rint(0, 99))} ${pad2(rint(0, 99))}`;
        case 'location.city': return pick(FR_CITY);
        case 'location.zipCode': return String(rint(1000, 95000)).padStart(5, '0');
        case 'location.streetAddress': return `${rint(1, 200)} rue ${pick(FR_LAST)}`;
        case 'location.country': return 'France';
        case 'company.name': return pick(COMPANY);
        case 'commerce.productName': return `${pick(PRODUCT)} ${pick(['Pro', 'Plus', 'Standard', 'Premium'])}`;
        case 'commerce.price': return (rint(Number(opts['min'] ?? 10), Number(opts['max'] ?? 500)) + Math.random()).toFixed(2);
        case 'finance.amount': return (rint(Number(opts['min'] ?? 100), Number(opts['max'] ?? 10000)) + Math.random()).toFixed(2);
        case 'number.int': return rint(Number(opts['min'] ?? 0), Number(opts['max'] ?? 100));
        case 'number.float': { const v = Number(opts['min'] ?? 0) + Math.random() * (Number(opts['max'] ?? 100) - Number(opts['min'] ?? 0)); const pr = Number(opts['precision'] ?? 2); return pr === 0 ? Math.round(v) : +v.toFixed(pr); }
        case 'string.uuid': return crypto.randomUUID();
        case 'database.mongodbObjectId': return Array.from({ length: 24 }, () => '0123456789abcdef'[rint(0, 15)]).join('');
        case 'lorem.sentence': return `${pick(PRODUCT)} ${pick(['à réviser', 'en cours', 'validé', 'à planifier'])}.`;
        case 'date.between': case 'date.future': case 'date.past': case 'date.recent': {
            const from = opts['from'] ? new Date(String(opts['from'])).getTime() : Date.now() - 31536000000;
            const to = opts['to'] ? new Date(String(opts['to'])).getTime() : Date.now();
            const d = new Date(from + Math.random() * (to - from));
            return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        }
        default: return '';
    }
}

interface Generator { faker?: string; pick?: unknown[] | { weighted?: unknown[] }; sequence?: string; start?: number; step?: number; [k: string]: unknown }

function generateValues(gen: Generator, count: number): unknown[] {
    if (gen.faker) {
        const opts = { ...gen }; delete opts.faker; delete (opts as Record<string, unknown>)['locale'];
        return Array.from({ length: count }, () => fakerValue(gen.faker as string, opts as Record<string, number | string>));
    }
    if (gen.pick) {
        const arr = (Array.isArray(gen.pick) ? gen.pick : (gen.pick.weighted || [])) as unknown[];
        return Array.from({ length: count }, () => arr[Math.floor(Math.random() * arr.length)]);
    }
    if (gen.sequence === 'counter') {
        const start = gen.start ?? 1, step = gen.step ?? 1;
        return Array.from({ length: count }, (_, i) => start + i * step);
    }
    return Array(count).fill(null);
}

function expandRange(rangeStr: string): string[] {
    const parts = rangeStr.split(':');
    if (parts.length === 1) return [parts[0]];
    const [start, end] = parts;
    const startCol = start.match(/[A-Z]+/)![0], startRow = parseInt(start.match(/\d+/)![0]);
    const endCol = end.match(/[A-Z]+/)![0], endRow = parseInt(end.match(/\d+/)![0]);
    const cells: string[] = [];
    for (let r = startRow; r <= endRow; r++)
        for (let c = startCol.charCodeAt(0); c <= endCol.charCodeAt(0); c++)
            cells.push(`${String.fromCharCode(c)}${r}`);
    return cells;
}

const argb = (hex: string) => 'FF' + String(hex || '000000').replace('#', '');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyStyle(sheet: any, op: XlsxOp): void {
    const s = (op['style'] || {}) as Record<string, unknown>;
    for (const ref of expandRange(String(op['range'] || op['cell']))) {
        const cell = sheet.getCell(ref);
        if (s['bold'] || s['italic'] || s['size'] || s['color']) {
            cell.font = { ...cell.font, bold: !!s['bold'], italic: !!s['italic'], size: s['size'] ? Number(s['size']) : undefined, color: s['color'] ? { argb: argb(String(s['color'])) } : cell.font?.color };
        }
        if (s['bgColor']) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(String(s['bgColor'])) } };
        if (s['align']) cell.alignment = { ...cell.alignment, horizontal: String(s['align']) };
    }
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Build an HTML table preview straight from the ops-built workbook (no re-parse). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function workbookPreview(wb: any): string {
    const sheet = wb.worksheets[0];
    if (!sheet) return '';
    const maxRows = 15, maxCols = 12;
    const rows: string[] = [];
    let rowCount = 0;
    sheet.eachRow({ includeEmpty: false }, (row: any, rowNumber: number) => {
        if (rowNumber > maxRows) return;
        rowCount++;
        const cells: string[] = [];
        for (let c = 1; c <= Math.min(sheet.columnCount || maxCols, maxCols); c++) {
            const cell = row.getCell(c);
            let val = cell.value;
            if (val && typeof val === 'object') val = (val.formula ? `=${val.formula}` : (val.result ?? val.text ?? JSON.stringify(val)));
            const tag = rowNumber === 1 ? 'th' : 'td';
            cells.push(`<${tag}>${esc(val)}</${tag}>`);
        }
        rows.push(`<tr>${cells.join('')}</tr>`);
    });
    if (!rowCount) return '';
    const more = (sheet.rowCount || 0) > maxRows ? `<div class="bp-gf__preview-empty">… ${sheet.rowCount - maxRows} lignes de plus</div>` : '';
    return `<table>${rows.join('')}</table>${more}`;
}

/**
 * Build the ExcelJS workbook from a declarative ops array (no serialisation).
 * `original` (ArrayBuffer) is the existing file for EDIT mode (file_id).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildWorkbook(ops: XlsxOp[], original?: ArrayBuffer | null): Promise<any> {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    if (original) { try { await wb.xlsx.load(original); } catch { /* fall through to CREATE */ } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sheet: any = wb.worksheets[0] || null;
    const ensure = () => sheet || (sheet = wb.worksheets[0] || wb.addWorksheet('Sheet1'));

    for (const op of ops) {
        try {
            switch (op['op']) {
                case 'addWorksheet': sheet = wb.addWorksheet(String(op['name'] || `Sheet${wb.worksheets.length + 1}`)); break;
                case 'selectSheet': { const t = wb.getWorksheet(String(op['name'])); if (t) sheet = t; break; }
                case 'setCell': ensure().getCell(String(op['cell'] || op['range'])).value = op['value']; break;
                case 'addRow': ensure().addRow((op['values'] as unknown[]) || []); break;
                case 'fillRange': {
                    const cells = expandRange(String(op['range']));
                    const vals = op['values'] ? (op['values'] as unknown[]) : op['generator'] ? generateValues(op['generator'] as Generator, cells.length) : null;
                    if (vals) cells.forEach((c, i) => { ensure().getCell(c).value = vals[i] ?? null; });
                    break;
                }
                case 'applyFormula': {
                    for (const ref of expandRange(String(op['range']))) {
                        const row = parseInt(ref.match(/\d+/)![0]);
                        ensure().getCell(ref).value = { formula: String(op['formula']).replace(/\{row\}/g, String(row)) };
                    }
                    break;
                }
                case 'setStyle': if (sheet) applyStyle(sheet, op); break;
                case 'mergeCells': if (sheet) sheet.mergeCells(String(op['range'])); break;
                case 'setColumnWidth': {
                    if (!sheet) break;
                    const widths = op['widths'] as Record<string, number> | undefined;
                    if (widths) for (const [col, w] of Object.entries(widths)) sheet.getColumn(col).width = Number(w) || 10;
                    else if (op['column']) sheet.getColumn(String(op['column'])).width = Number(op['width']) || 10;
                    break;
                }
                case 'setRowHeight': if (sheet && op['row']) sheet.getRow(Number(op['row'])).height = Number(op['height'] ?? 20); break;
                case 'setNumberFormat': if (sheet) for (const c of expandRange(String(op['range']))) sheet.getCell(c).numFmt = String(op['format'] || '0'); break;
                case 'addBorder': {
                    if (!sheet) break;
                    const style = String(op['style'] || 'thin'), color = { argb: argb(String(op['color'] || '000000')) };
                    const sides = (op['sides'] as string[]) || ['top', 'left', 'bottom', 'right'];
                    const border: Record<string, unknown> = {}; sides.forEach(s => border[s] = { style, color });
                    for (const c of expandRange(String(op['range']))) sheet.getCell(c).border = { ...sheet.getCell(c).border, ...border };
                    break;
                }
                case 'freezePane': if (sheet) sheet.views = [{ state: 'frozen', xSplit: Number(op['xSplit'] ?? 0), ySplit: Number(op['ySplit'] ?? 1) }]; break;
                case 'autoFilter': if (sheet) sheet.autoFilter = String(op['range'] || 'A1'); break;
                case 'addChart': console.warn('[xlsx_ops] addChart not supported by ExcelJS (op ignored)'); break;
                default: console.warn(`[xlsx_ops] op non gérée: ${op['op']}`);
            }
        } catch (err) {
            throw new Error(`op ${op['op']} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (wb.worksheets.length === 0) wb.addWorksheet('Sheet1');
    return wb;
}

/** Apply ops → .xlsx bytes + an HTML preview built from the resulting workbook. */
export async function applyXlsxOps(ops: XlsxOp[], original?: ArrayBuffer | null): Promise<{ bytes: ArrayBuffer; preview: string }> {
    const wb = await buildWorkbook(ops, original);
    const preview = workbookPreview(wb);
    const bytes = await wb.xlsx.writeBuffer() as ArrayBuffer;
    return { bytes, preview };
}

/** Build ONLY the HTML preview from a (possibly partial) ops list — for live streaming. */
export async function previewXlsxOps(ops: XlsxOp[]): Promise<string> {
    return workbookPreview(await buildWorkbook(ops, null));
}

/**
 * Extract the COMPLETE ops from a (possibly truncated) streamed JSON array text.
 * Tolerates a trailing partial object / missing `]`. Used to render the table
 * live as the aimini streams ops. Returns [] until the first full op closes.
 */
export function extractCompleteOps(text: string): XlsxOp[] {
    let s = text.trim();
    const fence = s.match(/```(?:json)?\s*\n?([\s\S]*)/);
    if (fence) s = fence[1];
    const start = s.indexOf('[');
    if (start < 0) return [];
    s = s.slice(start + 1);
    const ops: XlsxOp[] = [];
    let i = 0;
    while (i < s.length) {
        while (i < s.length && (s[i] === ',' || s[i] === ' ' || s[i] === '\n' || s[i] === '\r' || s[i] === '\t')) i++;
        if (i >= s.length || s[i] === ']') break;
        if (s[i] !== '{') break;
        let depth = 0, j = i, complete = false;
        let inStr: '"' | "'" | null = null, esc = false;
        for (; j < s.length; j++) {
            const ch = s[j];
            if (esc) { esc = false; continue; }
            if (inStr) { if (ch === '\\') esc = true; else if (ch === inStr) inStr = null; }
            else if (ch === '"' || ch === "'") inStr = ch;
            else if (ch === '{') depth++;
            else if (ch === '}') { depth--; if (depth === 0) { complete = true; break; } }
        }
        if (!complete) break;
        try { ops.push(JSON.parse(s.slice(i, j + 1))); } catch { break; }
        i = j + 1;
    }
    return ops;
}
