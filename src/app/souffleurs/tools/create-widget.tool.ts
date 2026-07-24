/**
 * create_widget — artefact non-fichier affiché dans la conversation
 * (html / svg / chart / code), produit par le souffleur-sandbox.
 * Résultat tool = confirmation seule ; le contenu part au renderer.
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';
import { SANDBOX_JS_SYSTEM } from '../executors/executor-prompts';
import { extractCode, runInSandbox } from '../executors/sandbox';
import { runExecutor } from '../souffleurs-provider';
import { widgetsByCall, type ProducedWidget } from './artifact-store';

export const createWidgetTool: AparteTool = {
  name: 'create_widget',
  description: 'Crée un artefact affiché (html/svg/chart/code).',
  inputSchema: {
    type: 'object',
    required: ['kind', 'task'],
    properties: {
      kind: { enum: ['html', 'svg', 'chart', 'code'] },
      task: { type: 'string' },
    },
  },
};

export const createWidgetHandler: AparteToolHandler = async (call) => {
  const kind = String(call.input['kind'] ?? 'code') as ProducedWidget['kind'];
  const task = String(call.input['task'] ?? '');
  try {
    const { raw } = await runExecutor('souffleur-sandbox', SANDBOX_JS_SYSTEM, task, {
      maxNewTokens: 4000,
    });
    const code = extractCode(raw);

    let content: string;
    if (kind === 'code') {
      // L'artefact EST le code généré.
      content = code;
    } else {
      const result = await runInSandbox('compute', code, { timeoutMs: 15_000 });
      content = result.kind === 'value' ? result.value : '[binaire inattendu]';
    }

    widgetsByCall.set(call.id, { kind, content });
    return {
      toolCallId: call.id,
      content: JSON.stringify({ ok: true, type: 'create_widget', kind }, null, 2),
    };
  } catch (err) {
    return {
      toolCallId: call.id,
      content: JSON.stringify(
        { ok: false, type: 'create_widget', kind, error: err instanceof Error ? err.message : String(err) },
        null,
        2,
      ),
    };
  }
};
