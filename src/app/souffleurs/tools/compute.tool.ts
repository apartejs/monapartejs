/**
 * compute — souffleur-sandbox: the generated code is executed in a sandbox Worker,
 * ONLY the result is reinjected (the user never sees the code —
 * a contract rule). Invisible segment (empty renderer).
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

export const computeHandler: AparteToolHandler = async (call, signal) => {
  const task = String(call.input['task'] ?? '');
  try {
    const { raw } = await runExecutor('souffleur-sandbox', SANDBOX_JS_SYSTEM, task, {
      maxNewTokens: 2000,
      signal,
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
