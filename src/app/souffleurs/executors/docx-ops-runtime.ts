/**
 * docx-ops-runtime.ts — executes le souffleur-xlsx-docx's declarative docx ops.
 *
 * Faithful port of executor.js du lab (v6, exécuteurs réutilisés tels quels en v7) (applyDocxOps),
 * backed by the `docx` lib (dep bonaparte). The aimini emits a JSON ops
 * array ({op:"addParagraph"}, {op:"setHeading"}, {op:"addTable"}, …) → this
 * builds a docx Document → Blob.
 */
// La lib docx est chargée dynamiquement (chunk différé — jamais dans le bundle initial).

export type DocxOp = Record<string, unknown>;

interface Run { text?: string; bold?: boolean; italic?: boolean; italics?: boolean; color?: string }

/** Apply a declarative docx ops array → return the .docx bytes. */
export async function applyDocxOps(ops: DocxOp[]): Promise<ArrayBuffer> {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, AlignmentType, PageBreak } = await import('docx');

    const buildRuns = (textOrRuns: unknown): InstanceType<typeof TextRun>[] => {
        if (typeof textOrRuns === 'string') return [new TextRun(textOrRuns)];
        if (Array.isArray(textOrRuns)) {
            return (textOrRuns as Run[]).map(r => new TextRun({ text: r.text || '', bold: r.bold, italics: r.italic ?? r.italics, color: r.color }));
        }
        return [new TextRun(String(textOrRuns ?? ''))];
    };

    const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];

    for (const op of ops) {
        try {
            switch (op['op']) {
                case 'addParagraph': {
                    const align = (op['align'] || op['alignment']) as string | undefined;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const pProps: any = { children: buildRuns(op['text'] ?? op['runs'] ?? '') };
                    if (align) pProps.alignment = (AlignmentType as Record<string, unknown>)[align.toUpperCase()] || AlignmentType.LEFT;
                    if (op['spacing']) pProps.spacing = op['spacing'];
                    children.push(new Paragraph(pProps));
                    break;
                }
                case 'setHeading': {
                    const levelKey = `HEADING_${op['level'] || 1}`;
                    children.push(new Paragraph({
                        heading: ((HeadingLevel as Record<string, unknown>)[levelKey] || HeadingLevel.HEADING_1) as (typeof HeadingLevel)[keyof typeof HeadingLevel],
                        children: buildRuns(op['text'] || ''),
                    }));
                    break;
                }
                case 'addTable': {
                    const rowsData = op['rows'] as unknown[][] | undefined;
                    if (Array.isArray(rowsData)) {
                        const rows = rowsData.map(rowData => new TableRow({
                            children: (rowData || []).map(cellText => new TableCell({ children: [new Paragraph({ children: buildRuns(cellText) })] })),
                        }));
                        children.push(new Table({ rows }));
                    }
                    break;
                }
                case 'addList': {
                    const items = (op['items'] as unknown[]) || [];
                    const numbered = !!op['numbered'];
                    items.forEach(text => children.push(new Paragraph({
                        text: String(text),
                        bullet: numbered ? undefined : { level: 0 },
                        numbering: numbered ? { reference: 'default-numbering', level: 0 } : undefined,
                    })));
                    break;
                }
                case 'addPageBreak': children.push(new Paragraph({ children: [new PageBreak()] })); break;
                case 'addHorizontalLine': children.push(new Paragraph({ border: { bottom: { color: '888888', space: 1, style: 'single', size: 6 } } })); break;
                case 'addBlankLine': children.push(new Paragraph({ children: [new TextRun('')] })); break;
                case 'addQuote': children.push(new Paragraph({ children: buildRuns(op['text'] || ''), indent: { left: 720 }, spacing: { before: 120, after: 120 } })); break;
                default: console.warn(`[docx_ops] op non gérée: ${op['op']}`);
            }
        } catch (err) {
            throw new Error(`op ${op['op']} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    return blob.arrayBuffer();
}

// ── HTML preview (declarative, straight from the ops) ────────────────────────
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A run/cell value is a plain string or an array of styled runs → inline HTML. */
function runsToHtml(textOrRuns: unknown): string {
    if (Array.isArray(textOrRuns)) {
        return (textOrRuns as Run[]).map(r => {
            let t = esc(r.text || '');
            if (r.bold) t = `<strong>${t}</strong>`;
            if (r.italic ?? r.italics) t = `<em>${t}</em>`;
            return t;
        }).join('');
    }
    return esc(typeof textOrRuns === 'string' ? textOrRuns : String(textOrRuns ?? ''));
}

const alignCss = (a: string): string => {
    const v = a.toLowerCase();
    if (v === 'both' || v === 'justified' || v === 'justify') return 'justify';
    if (v === 'center' || v === 'right') return v;
    return 'left';
};

/**
 * Build a lightweight HTML preview from a (possibly partial) docx ops array.
 * Used for BOTH the final card preview and the live streaming preview — mirrors
 * xlsx-ops-runtime's workbookPreview. Caps content so a runaway stream can't
 * blow up the DOM.
 */
export function docxOpsPreview(ops: DocxOp[]): string {
    const parts: string[] = [];
    const MAX_BLOCKS = 40;
    let blocks = 0;
    for (const op of ops) {
        if (blocks >= MAX_BLOCKS) break;
        switch (op['op']) {
            case 'setHeading': {
                const lvl = Math.min(Math.max(Number(op['level'] || 1), 1), 4);
                parts.push(`<h${lvl}>${runsToHtml(op['text'] || '')}</h${lvl}>`); blocks++; break;
            }
            case 'addParagraph': {
                const align = (op['align'] || op['alignment']) as string | undefined;
                const style = align ? ` style="text-align:${alignCss(align)}"` : '';
                parts.push(`<p${style}>${runsToHtml(op['text'] ?? op['runs'] ?? '')}</p>`); blocks++; break;
            }
            case 'addQuote': parts.push(`<blockquote>${runsToHtml(op['text'] || '')}</blockquote>`); blocks++; break;
            case 'addTable': {
                const rows = op['rows'] as unknown[][] | undefined;
                if (Array.isArray(rows)) {
                    const trs = rows.slice(0, 15).map((r, i) => {
                        const tag = i === 0 ? 'th' : 'td';
                        return `<tr>${(r || []).map(c => `<${tag}>${runsToHtml(c)}</${tag}>`).join('')}</tr>`;
                    }).join('');
                    parts.push(`<table>${trs}</table>`); blocks++;
                }
                break;
            }
            case 'addList': {
                const items = (op['items'] as unknown[]) || [];
                const tag = op['numbered'] ? 'ol' : 'ul';
                parts.push(`<${tag}>${items.slice(0, 20).map(it => `<li>${runsToHtml(it)}</li>`).join('')}</${tag}>`); blocks++; break;
            }
            case 'addHorizontalLine': parts.push('<hr>'); blocks++; break;
            case 'addPageBreak': parts.push('<hr class="bp-gf__pagebreak">'); blocks++; break;
            case 'addBlankLine': parts.push('<p>&nbsp;</p>'); break; // cosmetic, doesn't count
            default: break;
        }
    }
    if (!parts.length) return '';
    return `<div class="bp-gf__doc">${parts.join('')}</div>`;
}
