/**
 * SouffleursProvider — AparteAIProvider « own-I/O » pour le modèle aparté
 * (HF maxituc/aparte-souffleurs). Candidat plugin @aparte/provider-souffleurs.
 *
 * - Un seul pipeline navigateur (worker dédié) : toute opération (chat caller,
 *   préchargement, exécuteur) passe par une file d'attente unique.
 * - Déclare `function_calling` : AparteClient envoie alors les AparteTool
 *   enregistrés — utilisés ici comme LISTE D'ACTIVATION par nom ; le schéma
 *   sérialisé sur le fil vient de SOUFFLEUR_TOOL_DEFS (contrat d'entraînement).
 * - Les fichiers joints arrivent via request._meta.souffleurFiles (posé par un
 *   requestInterceptor côté app, avec rawFileInject:'none').
 */
import type {
  AparteAIModel,
  AparteAIProvider,
  AparteChatRequest,
  AparteChatResponse,
  AparteStreamEvent,
  ModelLoadProgress,
  ModelStatus,
} from '@aparte/core';

type ProviderMetadata = ReturnType<AparteAIProvider['getMetadata']>;
import {
  CALLER_ADAPTER,
  CALLER_DOWNLOAD_BYTES,
  CALLER_MAX_NEW_TOKENS,
  CALLER_MODEL_ID,
  EXECUTOR_MAX_NEW_TOKENS,
  SIZE_ADAPTER_BYTES,
  SOUFFLEURS_HF_REPO,
  VISION_MAX_NEW_TOKENS,
  type AdapterName,
} from './model-catalog';
import { adapterRole, getSouffleurManifest } from './manifest';
import { ProgressAggregator } from './progress-aggregator';
import { setSouffleurStatus } from './status';
import { buildSystemPrompt, type SouffleurFileRef } from './wire/system-prompt';
import { buildWirePrompt } from './wire/prompt-builder';
import { UNPARSEABLE, parsePythonicOutput } from './wire/pythonic-parser';
import { WireStreamDemux } from './wire/stream-demux';
import type {
  ComputeDevice,
  MainToWorker,
  WorkerFileProgress,
  WorkerToMain,
} from './worker-protocol';

/**
 * Canal fichiers : l'app pose `request._meta['souffleurFiles']` (via un
 * requestInterceptor, J3) — transmis intact par DirectTransport aux providers
 * own-I/O. Clé documentée ici, lue nulle part ailleurs.
 */
export const META_FILES_KEY = 'souffleurFiles';

const PROVIDER_ID = 'souffleurs';

/**
 * Dernier échange RÉELLEMENT envoyé sur le fil, capturé sans condition (deux
 * strings, coût nul). Sert au diagnostic hors console : /debug/prompt l'affiche.
 * C'est le seul moyen de répondre à « le bloc List of tools est-il là ? »
 * autrement qu'en croyant ce qu'on suppose.
 */
let _lastWire: { prompt: string; raw: string; at: number } | null = null;

export function getLastWire(): { prompt: string; raw: string; at: number } | null {
  return _lastWire;
}

interface PendingHandlers {
  onProgress?: (p: WorkerFileProgress) => void;
  onReady?: (adapter: AdapterName | 'vision', ms: number) => void;
  onChunk?: (delta: string) => void;
  onDone?: (usage: {
    inputTokens: number;
    outputTokens: number;
    ttftMs: number;
    durationMs: number;
  }) => void;
  onError?: (message: string) => void;
}

let _worker: Worker | null = null;
let _nextId = 1;
let _chain: Promise<unknown> = Promise.resolve();
let _device: ComputeDevice | null = null;
let _loadedAdapter: AdapterName | null = null;
const _pending = new Map<number, PendingHandlers>();

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL('./souffleurs.worker', import.meta.url), { type: 'module' });
    _worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
      const msg = event.data;
      const handlers = _pending.get(msg.id);
      switch (msg.type) {
        case 'progress':
          handlers?.onProgress?.(msg);
          break;
        case 'ready':
          // 'vision' n'est pas un adapter : le trio VL a pris la place du pipe
          // texte, donc plus aucun adapter n'est chargé.
          _loadedAdapter = msg.adapter === 'vision' ? null : msg.adapter;
          handlers?.onReady?.(msg.adapter, msg.ms);
          break;
        case 'chunk':
          handlers?.onChunk?.(msg.delta);
          break;
        case 'done':
          handlers?.onDone?.(msg.usage);
          _pending.delete(msg.id);
          break;
        case 'error':
          handlers?.onError?.(msg.message);
          _pending.delete(msg.id);
          break;
      }
    };
  }
  return _worker;
}

/** Détection RÉELLE de WebGPU (requestAdapter, pas juste `'gpu' in navigator`). */
export async function detectComputeDevice(): Promise<ComputeDevice> {
  if (_device) return _device;
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    _device = adapter ? 'webgpu' : 'wasm';
  } catch {
    _device = 'wasm';
  }
  return _device;
}

/** File d'attente unique : un seul pipeline, une seule opération à la fois. */
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const run = _chain.then(op, op);
  _chain = run.catch(() => undefined);
  return run;
}

/**
 * Verbosité par défaut, INJECTÉE (ce module ne connaît pas Angular, donc pas
 * `isDevMode()`) : l'app la pose à `isDevMode()` au boot. En dev on est bavard
 * sans rien avoir à activer — c'est le mode où on débugue.
 */
let _debugDefault = false;

export function setSouffleurDebug(enabled: boolean): void {
  _debugDefault = enabled;
}

/**
 * `bp.debug` reste un OVERRIDE explicite, dans les deux sens :
 *   '1' → force les traces (utile sur un build de prod)
 *   '0' → les fait taire (utile quand le dev est trop bruyant)
 * absent → on suit le mode de l'app.
 */
function isDebug(): boolean {
  try {
    const flag = localStorage.getItem('bp.debug');
    if (flag === '1') return true;
    if (flag === '0') return false;
  } catch {
    /* stockage indisponible : on suit le défaut */
  }
  return _debugDefault;
}

/** Résout les fichiers versionnés d'un adapter via le manifest (+ markSeen après ready). */
async function resolveAdapterFiles(adapter: AdapterName) {
  const manifest = await getSouffleurManifest();
  const role = adapterRole(adapter);
  return {
    files: {
      baseWeightsFile: manifest.baseWeightsFile(),
      adapterFile: manifest.file(role),
      // Le graphe greffé est bit-identique en texte (écart de logits mesuré :
      // 0) — on l'utilise donc pour TOUT dès qu'il est publié, et texte/vision
      // ne diffèrent plus que par `adapter.data`, comme un swap de souffleur.
      modelFileName: manifest.modelFileName(),
    },
    size: manifest.size(role) ?? SIZE_ADAPTER_BYTES,
    markSeen: () => manifest.markSeen(role),
  };
}

function genCallId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `call_${Date.now()}_${_nextId++}`;
}

const MODELS: AparteAIModel[] = [
  {
    id: CALLER_MODEL_ID,
    name: 'aparté (local)',
    capabilities: ['streaming', 'function_calling'],
    description:
      'Souffleur-chat — tourne entièrement dans votre navigateur, rien ne sort de votre appareil.',
  },
];

export const SouffleursProvider: AparteAIProvider = {
  id: PROVIDER_ID,

  getMetadata(): ProviderMetadata {
    return {
      id: PROVIDER_ID,
      name: 'aparté',
      description: 'Souffleurs locaux (WebGPU/WASM) — 100 % navigateur',
      color: 'var(--aparte-primary)',
    };
  },

  // SYNCHRONE obligatoirement : aparteGlobalConfig.getCurrentModel() ignore les Promise,
  // et sans modèle courant le gate function_calling coupe les tools.
  getModels(): AparteAIModel[] {
    return MODELS;
  },

  async chat(request: AparteChatRequest): Promise<AparteChatResponse> {
    const device = await detectComputeDevice();
    const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
    const enabledTools = request.tools?.map((t) => t.name) ?? [];
    const files = (request._meta?.[META_FILES_KEY] as SouffleurFileRef[] | undefined) ?? [];
    const system = buildSystemPrompt(enabledTools, files);
    const prompt = buildWirePrompt(system, request.messages);
    const maxNewTokens = Math.max(request.maxTokens ?? 0, CALLER_MAX_NEW_TOKENS);
    // Diagnostic : actif d'office en dev (voir setSouffleurDebug) — prompt wire
    // exact, sortie brute et appels parsés dans la console, + ids côté worker.
    // `localStorage.setItem('bp.debug','0')` fait taire, '1' force en prod.
    const debug = isDebug();

    let raw = '';
    const demux = new WireStreamDemux();
    _lastWire = { prompt, raw: '', at: Date.now() };

    // Annulation : le consommateur ferme le controller AVANT que le worker
    // n'ait fini son tour (`stopping.interrupt()` n'est vu qu'au token suivant).
    // Sans ce drapeau, le `done` tardif appelait enqueue() sur un stream fermé
    // → TypeError DANS onmessage, donc `resolve()` jamais atteint et `_chain`
    // bloquée à vie (plus AUCUNE génération ensuite).
    let closed = false;

    return new ReadableStream<AparteStreamEvent>({
      start: (controller) => {
        const emit = (ev: AparteStreamEvent) => {
          if (!closed) controller.enqueue(ev);
        };
        const finish = () => {
          if (closed) return;
          closed = true;
          controller.close();
        };
        const emitDemux = (deltas: ReturnType<WireStreamDemux['push']>) => {
          for (const ev of deltas) {
            emit(
              ev.kind === 'text'
                ? { type: 'text', delta: ev.delta }
                : { type: 'thinking', delta: ev.delta },
            );
          }
        };

        setSouffleurStatus({
          status: _loadedAdapter === CALLER_ADAPTER ? 'generating' : 'loading',
          device,
        });

        void enqueue(
          () =>
            new Promise<void>((resolve) => {
              const id = _nextId++;
              _pending.set(id, {
                onReady: () => resolved.markSeen(),
                onChunk: (delta) => {
                  raw += delta;
                  emitDemux(demux.push(delta));
                },
                onDone: (usage) => {
                  emitDemux(demux.flush());
                  if (_lastWire) _lastWire.raw = raw;
                  const parsed = parsePythonicOutput(raw);
                  if (debug) {
                    console.log('[souffleurs] PROMPT WIRE >>>\n%s', prompt);
                    console.log('[souffleurs] SORTIE BRUTE >>>\n%s', raw);
                    console.log('[souffleurs] PARSED >>>', parsed);
                  }
                  // Tour annulé : on ne déclenche PAS les outils que le modèle
                  // avait commencé à annoncer (emit() est déjà neutralisé).
                  if (!closed) {
                    for (const call of parsed.calls) {
                      if (call.name === UNPARSEABLE) {
                        console.warn('[souffleurs] tool_call imparsable ignoré:', call.args['raw']);
                        continue;
                      }
                      emit({
                        type: 'tool_use',
                        id: genCallId(),
                        name: call.name,
                        input: call.args,
                      });
                    }
                  }
                  emit({ type: 'done', usage });
                  setSouffleurStatus({ status: 'ready', device });
                  finish();
                  resolve();
                },
                onError: (message) => {
                  emit({ type: 'error', message });
                  setSouffleurStatus({ status: 'error', message, device });
                  finish();
                  resolve();
                },
              });
              getWorker().postMessage({
                type: 'generate',
                id,
                adapter: CALLER_ADAPTER,
                device,
                prompt,
                maxNewTokens,
                debug,
                ...resolved.files,
              } satisfies MainToWorker);
            }),
        );
      },
      cancel: () => {
        // Le stream est DÉJÀ fermé par le consommateur : plus aucun enqueue ni
        // close() (les deux jetteraient). Le handler `_pending` reste en place
        // pour que le `done`/`error` du worker résolve la file (`_chain`).
        closed = true;
        setSouffleurStatus({ status: 'ready', device });
        getWorker().postMessage({ type: 'abort' } satisfies MainToWorker);
      },
    });
  },

  async getModelStatus(_modelId: string): Promise<ModelStatus> {
    if (_loadedAdapter === CALLER_ADAPTER) return 'ready';
    try {
      if (typeof caches === 'undefined') return 'not-downloaded';
      const manifest = await getSouffleurManifest();
      const basename = (path: string) => path.split('/').pop() ?? path;
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      const has = (fragment: string) => keys.some((req) => req.url.includes(fragment));
      // Fichiers de la version COURANTE du manifest : une version bumpée
      // apparaît comme not-downloaded (l'onboarding/modal retélécharge).
      return has(basename(manifest.baseWeightsFile())) && has(basename(manifest.file('chat')))
        ? 'cached'
        : 'not-downloaded';
    } catch {
      return 'not-downloaded';
    }
  },

  async prepareModel(_modelId: string, onProgress: (p: ModelLoadProgress) => void): Promise<void> {
    const device = await detectComputeDevice();
    const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
    return enqueue(
      () =>
        new Promise<void>((resolve, reject) => {
          const id = _nextId++;
          const aggregator = new ProgressAggregator(CALLER_DOWNLOAD_BYTES);
          _pending.set(id, {
            onProgress: (p) => {
              const progress = aggregator.push(p);
              setSouffleurStatus({ status: 'downloading', progress, device });
              onProgress({ status: 'downloading', file: p.file, progress });
            },
            onReady: () => {
              _pending.delete(id);
              resolved.markSeen();
              setSouffleurStatus({ status: 'ready', device });
              onProgress({ status: 'ready', progress: 100 });
              resolve();
            },
            onError: (message) => {
              setSouffleurStatus({ status: 'error', message, device });
              onProgress({ status: 'error', message });
              reject(new Error(message));
            },
          });
          getWorker().postMessage({
            type: 'prepare',
            id,
            adapter: CALLER_ADAPTER,
            device,
            ...resolved.files,
          } satisfies MainToWorker);
        }),
    );
  },

  async deleteModel(_modelId: string): Promise<void> {
    getWorker().postMessage({ type: 'dispose' } satisfies MainToWorker);
    _loadedAdapter = null;
    try {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      await Promise.all(
        keys.filter((req) => req.url.includes(SOUFFLEURS_HF_REPO)).map((req) => cache.delete(req)),
      );
    } catch {
      // cache indisponible : rien à effacer
    }
    setSouffleurStatus({ status: 'not-downloaded' });
  },
};

/* ── Surface étendue (hors AparteAIProvider) ─────────────────────────────── */

export type ExecutorAdapter = Exclude<AdapterName, 'souffleur-chat'>;

export interface ExecutorResult {
  raw: string;
  usage: { inputTokens: number; outputTokens: number; ttftMs: number; durationMs: number };
}

/* ── Vision : hot-swap de l'encodeur ──────────────────────────────────────── */

/**
 * read_file(image) — rattache l'ENCODEUR et interroge l'image.
 *
 * Passe par la MÊME file que les souffleurs : mécaniquement c'est un swap de
 * rôle (même graphe, mêmes poids, `adapter.data` neutre) plus une session tour.
 * Le texte rendu repart en résultat d'outil et souffleur-chat enchaîne — lui
 * reste text-only et ne voit jamais de pixels (règle du contrat).
 *
 * Jette si le bloc `vision` n'est pas dans le manifest : le handler read_file
 * transforme ça en `ok:false` avec le message, désormais affiché à l'utilisateur.
 */
export async function describeImage(blob: Blob, question: string): Promise<string> {
  const device = await detectComputeDevice();
  const manifest = await getSouffleurManifest();
  const vision = manifest.vision();
  if (!vision) {
    throw new Error(
      "analyse d'image indisponible : l'encodeur vision n'est pas publié pour cette version du modèle",
    );
  }
  const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
  const base = `https://huggingface.co/${SOUFFLEURS_HF_REPO}/resolve/main`;
  const debug = isDebug();

  setSouffleurStatus({ status: 'loading', device });
  return enqueue(
    () =>
      new Promise<string>((resolve, reject) => {
        const id = _nextId++;
        const aggregator = new ProgressAggregator(vision.size);
        let text = '';
        _pending.set(id, {
          onProgress: (p) =>
            setSouffleurStatus({ status: 'downloading', progress: aggregator.push(p), device }),
          onReady: () => setSouffleurStatus({ status: 'generating', device }),
          onChunk: (delta) => {
            text += delta;
          },
          onDone: () => {
            _pending.delete(id);
            // Le rôle vision occupe la place : le souffleur se rechargera au
            // tour suivant (même invariant que le swap d'un exécuteur).
            _loadedAdapter = null;
            setSouffleurStatus({ status: 'ready', device });
            resolve(text.trim());
          },
          onError: (message) => {
            _pending.delete(id);
            _loadedAdapter = null;
            setSouffleurStatus({ status: 'error', message, device });
            reject(new Error(message));
          },
        });
        getWorker().postMessage({
          type: 'describe-image',
          id,
          device,
          blob,
          question,
          maxNewTokens: VISION_MAX_NEW_TOKENS,
          tower: {
            graphUrl: `${base}/${vision.tower}`,
            dataUrl: `${base}/${vision.tower_data}`,
            internalDataName: vision.tower_internal_data,
            // Gabarit de l'adapter neutre : exactement la taille d'un `.data`
            // de souffleur, alloué côté worker (zéro octet réseau).
            adapterByteLength: manifest.size(adapterRole(CALLER_ADAPTER)) ?? SIZE_ADAPTER_BYTES,
          },
          debug,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}

/** Précharge un adapter exécuteur (86 MB, base partagée déjà en cache). */
export async function prepareExecutor(
  adapter: ExecutorAdapter,
  onProgress?: (p: ModelLoadProgress) => void,
): Promise<void> {
  const device = await detectComputeDevice();
  const resolved = await resolveAdapterFiles(adapter);
  return enqueue(
    () =>
      new Promise<void>((resolve, reject) => {
        const id = _nextId++;
        const aggregator = new ProgressAggregator(resolved.size);
        _pending.set(id, {
          onProgress: (p) =>
            onProgress?.({ status: 'downloading', file: p.file, progress: aggregator.push(p) }),
          onReady: () => {
            _pending.delete(id);
            resolved.markSeen();
            resolve();
          },
          onError: (message) => reject(new Error(message)),
        });
        getWorker().postMessage({
          type: 'prepare',
          id,
          adapter,
          device,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}

/** Recharge le caller dans le pipeline (après un prefetch d'exécuteurs). */
export async function prepareCaller(): Promise<void> {
  const device = await detectComputeDevice();
  const resolved = await resolveAdapterFiles(CALLER_ADAPTER);
  return enqueue(
    () =>
      new Promise<void>((resolve, reject) => {
        const id = _nextId++;
        _pending.set(id, {
          onReady: () => {
            _pending.delete(id);
            resolve();
          },
          onError: (message) => reject(new Error(message)),
        });
        getWorker().postMessage({
          type: 'prepare',
          id,
          adapter: CALLER_ADAPTER,
          device,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}

/**
 * Exécute un souffleur exécuteur (pdf / xlsx-docx / sandbox) — J3.
 * Passe par la MÊME file d'attente que le caller (un seul pipeline, swap ≈ 3,8 s).
 * Invisible pour la boucle AparteClient : un aller-retour exécuteur = zéro tour agentique.
 */
export async function runExecutor(
  adapter: ExecutorAdapter,
  systemPrompt: string,
  task: string,
  opts: { maxNewTokens?: number; onChunk?: (raw: string) => void } = {},
): Promise<ExecutorResult> {
  const device = await detectComputeDevice();
  const resolved = await resolveAdapterFiles(adapter);
  // Préfixe `intent: ` — FORMAT D'ENTRAÎNEMENT des trois exécuteurs (100 % des
  // exemples : pdf 1228/1228, xlsx-docx 1056/1056, sandbox 1492/1492, audit lab
  // du 26/07, HANDOFF-fixes-bonaparte §1), et ce que fait l'exécuteur du lab
  // (`browser/app/executor.js` : `intent: ${args.intent}`). L'app envoyait la
  // task nue : chaque génération de fichier partait hors distribution.
  const prompt = buildWirePrompt(systemPrompt, [{ role: 'user', content: `intent: ${task}` }]);
  // Cycle visible (mascotte/pastille) : loading pendant le swap, generating
  // pendant la production de l'exécuteur, ready au retour.
  setSouffleurStatus({ status: 'loading', device });
  return enqueue(
    () =>
      new Promise<ExecutorResult>((resolve, reject) => {
        const id = _nextId++;
        let raw = '';
        _pending.set(id, {
          onProgress: (p) => {
            if (!p.done) setSouffleurStatus({ status: 'downloading', device });
          },
          onReady: () => {
            resolved.markSeen();
            setSouffleurStatus({ status: 'generating', device });
          },
          onChunk: (delta) => {
            raw += delta;
            opts.onChunk?.(raw);
          },
          onDone: (usage) => {
            setSouffleurStatus({ status: 'ready', device });
            resolve({ raw: raw.split('<|im_end|>')[0], usage });
          },
          onError: (message) => {
            setSouffleurStatus({ status: 'error', message, device });
            reject(new Error(message));
          },
        });
        getWorker().postMessage({
          type: 'generate',
          id,
          adapter,
          device,
          prompt,
          maxNewTokens: opts.maxNewTokens ?? EXECUTOR_MAX_NEW_TOKENS,
          ...resolved.files,
        } satisfies MainToWorker);
      }),
  );
}
