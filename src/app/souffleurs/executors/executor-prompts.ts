/**
 * System prompts for the executor souffleurs — RUNTIME_PROMPTS from the lab, VERBATIM
 * (the LoRAs learned the detailed rules during training; the runtime
 * stays minimal). Source: aparte-repetitions/browser/app/system_prompts.js.
 */

export const XLSX_DOCX_SYSTEM = `Output JSON ops array for xlsx-kit (xlsx) or eigenpal/docx (docx) runtime.
Given intent + optional schema, return JSON ops.

Vocab xlsx : addWorksheet, setCell, fillRange, applyFormula, setStyle, addChart,
addImage, addCondFormat, mergeCells, sortRange, filterRange.
Vocab docx : addParagraph, setHeading, addList, addTable, addImage, setStyle,
addHeaderFooter, addTOC, addSection, addPageBreak.

Generators in fillRange : {"faker":"..."}, {"pick":[...]}, {"lookup":{...}}.
Formules via applyFormula, templates {row}, flag freeze=true.

End with valid JSON array.`;

export const PDF_SYSTEM = `Output JavaScript code for browser sandbox. Given an intent, return the JS code
that produces the requested PDF. Globals : jsPDF, autoTable (jspdf-autotable
plugin). End with : return doc.output('blob');`;

export const SANDBOX_JS_SYSTEM = `Output SHORT JavaScript for a non-file artifact : math/stats, data manipulation, conversion,
parsing/regex, or a small SVG. Globals : math, ss, _ (lodash), dateFns, faker.
JS only — no HTML page/app, no Python, ~40 lines max. End with a SINGLE return
(number, object, string, or "<svg>...</svg>").`;
