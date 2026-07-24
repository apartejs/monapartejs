/**
 * compute — souffleur-sandbox : le code généré est exécuté en sandbox Worker,
 * SEUL le résultat est réinjecté (l'utilisateur ne voit jamais le code —
 * règle du contrat). Segment invisible (renderer vide).
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { SANDBOX_JS_SYSTEM } from '../executors/executor-prompts';
import { extractCode, runInSandbox } from '../executors/sandbox';
import { runExecutor } from '../souffleurs-provider';

export const computeTool: AparteTool = {
  name: 'compute',
  description: 'Exécute un calcul exact en sandbox.',
  inputSchema: {
    type: 'object',
    required: ['task'],
    properties: { task: { type: 'string' } },
  },
};

export const computeHandler: AparteToolHandler = async (call) => {
  const task = String(call.input['task'] ?? '');
  try {
    const { raw } = await runExecutor('souffleur-sandbox', SANDBOX_JS_SYSTEM, task, {
      maxNewTokens: 2000,
    });
    const code = extractCode(raw);
    const result = await runInSandbox('compute', code, { timeoutMs: 15_000 });
    const value = result.kind === 'value' ? result.value : '[binaire inattendu]';
    return {
      toolCallId: call.id,
      content: JSON.stringify({ ok: true, type: 'compute', result: value }, null, 2),
    };
  } catch (err) {
    return {
      toolCallId: call.id,
      content: JSON.stringify(
        { ok: false, type: 'compute', error: err instanceof Error ? err.message : String(err) },
        null,
        2,
      ),
    };
  }
};
