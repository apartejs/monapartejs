/**
 * Runner de la sandbox : un Worker FRAIS par exécution (isolation maximale),
 * timeout dur par terminate(). Le code généré ne partage jamais d'état.
 */
import type { SandboxLib } from './sandbox.worker';

export interface SandboxBinaryResult {
  kind: 'binary';
  data: Uint8Array;
  mime: string;
}

export interface SandboxValueResult {
  kind: 'value';
  value: string;
}

export type SandboxResult = SandboxBinaryResult | SandboxValueResult;

const DEFAULT_TIMEOUT_MS = 30_000;

export function runInSandbox(
  lib: SandboxLib,
  code: string,
  opts: { timeoutMs?: number } = {},
): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sandbox.worker', import.meta.url), { type: 'module' });
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`sandbox timeout (${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms)`));
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    worker.onmessage = (event) => {
      const msg = event.data ?? {};
      if (msg.type === 'exec-ok') {
        clearTimeout(timeout);
        worker.terminate();
        resolve(
          msg.value !== undefined
            ? { kind: 'value', value: String(msg.value) }
            : { kind: 'binary', data: msg.data as Uint8Array, mime: String(msg.mime) },
        );
      } else if (msg.type === 'exec-error') {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(`${msg.phase}: ${msg.message}`));
      }
    };
    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(err.message || 'sandbox worker error'));
    };

    worker.postMessage({ type: 'exec', id: 1, lib, code });
  });
}

/** Nettoie la sortie code d'un souffleur : fences markdown, im_end résiduel. */
export function extractCode(raw: string): string {
  let code = raw.split('<|im_end|>')[0].trim();
  const fence = code.match(/```(?:javascript|js)?\s*\n?([\s\S]*?)```/);
  if (fence) code = fence[1];
  else code = code.replace(/^```(?:javascript|js)?\s*\n?/, '').replace(/```\s*$/, '');
  return code.trim();
}
