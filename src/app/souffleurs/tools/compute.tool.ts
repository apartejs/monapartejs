/**
 * compute (ADR-003) — the caller writes the expression itself, with the conversation's numbers; the app evaluates
 * it with the same grammar the lab checked the training data with (./expression.ts, a port of
 * aparte-repetitions gen/validators/expression.py). No executor, no code from the model. ONLY the result is
 * reinjected; the segment stays invisible (registerToolDisplay hidden).
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { asToolResult } from './expression';

/** Activation by name: the model reads the contract's own words (wire/contract-lfm3.ts), not this schema. */
export const computeTool: AparteTool = {
  name: 'compute',
  description: 'Calcule exactement une expression.',
  inputSchema: {
    type: 'object',
    required: ['expression'],
    properties: { expression: { type: 'string' } },
  },
};

export const computeHandler: AparteToolHandler = async (call) => ({
  toolCallId: call.id,
  content: JSON.stringify(asToolResult(String(call.input['expression'] ?? ''))),
});
