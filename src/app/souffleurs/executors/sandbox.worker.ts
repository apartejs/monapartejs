/// <reference lib="webworker" />
/**
 * Sandbox Worker — exécute le JS généré par les souffleurs (pdf / sandbox)
 * dans un Worker dédié. Port du sandbox.worker d'aimi, adapté au contrat v7 :
 *  - réseau et importScripts supprimés AVANT tout code utilisateur ;
 *  - `jspdf` : code du souffleur-pdf (jsPDF + autoTable, return doc.output('blob')) ;
 *  - `compute` : code du souffleur-sandbox — retourne une VALEUR (nombre/objet/
 *    string/SVG), avec les globals annoncés par le prompt runtime :
 *    math (mathjs), ss (simple-statistics), _ (lodash), dateFns, faker (mini).
 *  - timeout dur côté hôte via Worker.terminate().
 */

const networkBlocker = () => {
  throw new Error('Network access is blocked in sandbox');
};
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'navigator']) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (self as any)[name];
  } catch {
    /* read-only : écrasé ci-dessous */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = self as any;
g.fetch = networkBlocker;
g.XMLHttpRequest = networkBlocker;
g.WebSocket = networkBlocker;
g.EventSource = networkBlocker;
g.importScripts = networkBlocker;

export type SandboxLib = 'jspdf' | 'compute' | 'native';

interface LibBinding {
  globals: Record<string, unknown>;
  mime: string;
}

const cached: Partial<Record<SandboxLib, LibBinding>> = {};

async function loadLib(lib: SandboxLib): Promise<LibBinding> {
  const hit = cached[lib];
  if (hit) return hit;

  let binding: LibBinding;
  switch (lib) {
    case 'jspdf': {
      const { jsPDF } = await import('jspdf');
      // Deux formes doivent marcher, parce que le prompt runtime (verbatim du
      // contrat, on n'y touche pas) annonce « Globals : jsPDF, autoTable » alors
      // que le dataset qui a entraîné souffleur-pdf n'utilise que
      // `doc.autoTable({...})` (477/477, audit lab du 26/07 §3). Sans
      // `applyPlugin`, la forme méthode crashe ; sans le global, la forme
      // fonction `autoTable(doc, {...})` que le prompt invite crashe. On expose
      // les deux : le modèle ne peut plus se tromper de porte.
      const globals: Record<string, unknown> = { jsPDF };
      try {
        const { applyPlugin, autoTable } = await import('jspdf-autotable');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        applyPlugin(jsPDF as any);
        globals['autoTable'] = autoTable;
      } catch {
        /* plugin optionnel — le code sans tableau marche quand même */
      }
      binding = { globals, mime: 'application/pdf' };
      break;
    }
    case 'compute': {
      // Globals du prompt runtime sandbox_js — lazy (chunks différés).
      // Le VRAI @faker-js/faker (locale fr, comme le harnais d'entraînement) :
      // le souffleur-sandbox émet du faker.location/commerce/date/etc. que le
      // mini-shim ne couvrait pas.
      const [math, ss, lodash, dateFns, fakerMod] = await Promise.all([
        import('mathjs'),
        import('simple-statistics'),
        import('lodash-es'),
        import('date-fns'),
        import('@faker-js/faker'),
      ]);
      binding = {
        globals: {
          math,
          ss,
          _: lodash,
          dateFns,
          faker: fakerMod.fakerFR ?? fakerMod.faker,
          TextEncoder,
        },
        mime: 'application/json',
      };
      break;
    }
    case 'native':
      binding = { globals: { TextEncoder }, mime: 'application/octet-stream' };
      break;
  }
  cached[lib] = binding;
  return binding;
}

async function toUint8(value: unknown): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  const v = value as { buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number };
  if (v && v.buffer instanceof ArrayBuffer && typeof v.byteLength === 'number') {
    return new Uint8Array(v.buffer, v.byteOffset ?? 0, v.byteLength);
  }
  throw new Error(`Generated value is not a binary type (got ${typeof value})`);
}

self.addEventListener('message', async (event: MessageEvent) => {
  const { type, id, lib, code } = event.data ?? {};
  if (type !== 'exec') return;

  let binding: LibBinding;
  try {
    binding = await loadLib(lib as SandboxLib);
  } catch (err) {
    self.postMessage({ type: 'exec-error', id, message: String(err), phase: 'load' });
    return;
  }

  const paramNames = Object.keys(binding.globals);
  const paramValues = paramNames.map((n) => binding.globals[n]);

  let userFn: (...args: unknown[]) => Promise<unknown>;
  try {
    const AsyncFunction = (async function () {}).constructor as new (
      ...args: string[]
    ) => (...a: unknown[]) => Promise<unknown>;
    userFn = new AsyncFunction(...paramNames, code);
  } catch (err) {
    self.postMessage({ type: 'exec-error', id, message: `Compile error: ${String(err)}`, phase: 'exec' });
    return;
  }

  try {
    const result = await userFn(...paramValues);
    if (lib === 'compute') {
      let value: string;
      try {
        value = typeof result === 'string' ? result : JSON.stringify(result);
      } catch {
        value = String(result);
      }
      self.postMessage({ type: 'exec-ok', id, value, mime: binding.mime });
      return;
    }
    const data = await toUint8(result);
    self.postMessage({ type: 'exec-ok', id, data, mime: binding.mime }, [data.buffer]);
  } catch (err) {
    self.postMessage({ type: 'exec-error', id, message: String(err), phase: 'exec' });
  }
});
