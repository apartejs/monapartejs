/// <reference lib="webworker" />
/**
 * Worker d'inférence souffleurs — un seul pipeline en mémoire.
 * Chargement fidèle au harness validé du lab : base q4 partagée + adapter LoRA
 * remappé via session_options.externalData ; hot-swap = dispose + re-pipeline
 * avec un autre `.data` (la base reste dans le Cache API du navigateur).
 * Génération : greedy, prompt wire pré-assemblé (JAMAIS apply_chat_template —
 * le template embarqué du repo HF ignore tool_calls), decode avec
 * skip_special_tokens:false pour voir les marqueurs tool_call/im_end.
 */
import {
  InterruptableStoppingCriteria,
  Tensor,
  TextStreamer,
  pipeline,
} from '@huggingface/transformers';
import {
  preprocessImage,
  expectedImageTokens,
  expectedTotalTokens,
  TOKENS_PER_TILE,
  type PreprocessedImage,
} from './vision/image-preprocess';
import { attachTower, detachTower, encodeImage } from './vision/vision-tower';
import { SOUFFLEURS_HF_REPO, type AdapterName } from './model-catalog';
import type {
  AdapterFiles,
  ComputeDevice,
  MainToWorker,
  TowerFiles,
  WorkerToMain,
} from './worker-protocol';

const post = (msg: WorkerToMain) => (self as unknown as Worker).postMessage(msg);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: any = null;
/** Clé de swap = le FICHIER adapter (versionné) : nouvelle version = re-pipeline. */
let currentAdapterFile: string | null = null;
const stopping = new InterruptableStoppingCriteria();

/** Nom de graphe courant : le graphe vision et le texte sont deux fichiers. */
let currentModelFile: string | null = null;

/**
 * Adapter NEUTRE pour l'appel describe — des zéros, donc un delta LoRA nul,
 * donc la base pristine, qui est justement ce que la tour a appris à décrire
 * (souffleur-chat, lui, est entraîné à sortir des tool_calls : hors sujet ici).
 * Alloué côté client : ZÉRO octet sur le réseau.
 */
let neutralAdapter: Uint8Array | null = null;

function getNeutralAdapter(byteLength: number): Uint8Array {
  if (!neutralAdapter || neutralAdapter.byteLength !== byteLength) {
    neutralAdapter = new Uint8Array(byteLength);
  }
  return neutralAdapter;
}

/**
 * Embeds d'image du tour EN COURS. Le hook sur
 * `prepare_inputs_for_generation` les fournit au PREFILL puis passe des
 * tenseurs vides : les indices ne valent que pour la séquence complète, et un
 * ScatterND vide est inerte (écart de logits mesuré : 0).
 */
let pendingImage: { features: Float32Array; indices: BigInt64Array; numTokens: number } | null =
  null;
let prefillDone = false;

const HIDDEN = 2048;
const EMPTY_FEATURES = new Tensor('float32', new Float32Array(0), [0, HIDDEN]);
const EMPTY_INDICES = new Tensor('int64', new BigInt64Array(0), [0, 2]);

/**
 * Le graphe greffé déclare `image_features`/`image_indices` en entrées REQUISES
 * (mesuré : avec un initializer par défaut, ORT les classe en « overridable
 * initializer » et transformers.js — qui pioche dans `session.inputNames` — ne
 * les transmet jamais). On les fournit donc à chaque forward, via le seul point
 * rappelé à chaque étape de la boucle de génération.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function installImageHook(model: any): void {
  const session = model.sessions?.['model'];
  if (!session?.inputNames?.includes('image_features')) return; // graphe texte historique
  if (model.__aparteImageHook) return;
  const orig = model.prepare_inputs_for_generation.bind(model);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model.prepare_inputs_for_generation = (ids: any, inputs: any, cfg: any) => {
    const out = orig(ids, inputs, cfg);
    if (!prefillDone && pendingImage) {
      out.image_features = new Tensor('float32', pendingImage.features, [
        pendingImage.numTokens,
        HIDDEN,
      ]);
      out.image_indices = new Tensor('int64', pendingImage.indices, [
        pendingImage.numTokens,
        2,
      ]);
    } else {
      out.image_features = EMPTY_FEATURES;
      out.image_indices = EMPTY_INDICES;
    }
    prefillDone = true;
    return out;
  };
  model.__aparteImageHook = true;
}

self.onmessage = async (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'prepare':
        await ensurePipeline(msg.id, msg.adapter, msg.device, msg, msg.modelFileName ?? 'model');
        break;
      case 'generate':
        await generate(msg.id, msg.adapter, msg.device, msg.prompt, msg.maxNewTokens, msg, msg.debug);
        break;
      case 'describe-image':
        await describeImage(msg);
        break;
      case 'abort':
        stopping.interrupt();
        break;
      case 'dispose':
        await releaseText();
        await detachTower();
        break;
    }
  } catch (err) {
    const id = 'id' in msg ? msg.id : -1;
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};

async function releaseText(): Promise<void> {
  if (!pipe) return;
  await pipe.dispose?.();
  pipe = null;
  currentAdapterFile = null;
  currentModelFile = null;
}

/**
 * Charge le pipeline pour un rôle. « Rôle » inclut désormais la VISION : c'est
 * le même graphe et les mêmes poids, seul `adapter.data` change — donc un swap
 * de vision est EXACTEMENT un swap de souffleur.
 *
 * `adapterData` : chemin dans le repo (souffleur versionné) OU tampon d'octets
 * (adapter neutre de l'appel describe, alloué localement).
 */
async function ensurePipeline(
  id: number,
  adapter: AdapterName | 'vision',
  device: ComputeDevice,
  files: AdapterFiles,
  modelFileName = 'model',
  adapterData: string | Uint8Array = files.adapterFile,
): Promise<void> {
  const key = typeof adapterData === 'string' ? adapterData : '__neutral__';
  if (pipe && currentAdapterFile === key && currentModelFile === modelFileName) {
    post({ type: 'ready', id, adapter, ms: 0 });
    return;
  }
  const t0 = performance.now();
  await releaseText();

  const options = {
    device,
    dtype: 'q4',
    model_file_name: modelFileName,
    use_external_data_format: false,
    session_options: {
      externalData: [
        { path: 'model_q4.onnx_data', data: files.baseWeightsFile },
        { path: 'adapter.data', data: adapterData },
      ],
    },
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.file && (p.status === 'progress' || p.status === 'done')) {
        post({
          type: 'progress',
          id,
          file: p.file,
          loaded: p.loaded ?? 0,
          total: p.total ?? 0,
          done: p.status === 'done',
        });
      }
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipe = await pipeline('text-generation', SOUFFLEURS_HF_REPO, options as any);
  currentAdapterFile = key;
  currentModelFile = modelFileName;
  installImageHook(pipe.model);
  post({ type: 'ready', id, adapter, ms: Math.round(performance.now() - t0) });
}

async function generate(
  id: number,
  adapter: AdapterName,
  device: ComputeDevice,
  prompt: string,
  maxNewTokens: number,
  files: AdapterFiles,
  debug = false,
): Promise<void> {
  await ensurePipeline(id, adapter, device, files, files.modelFileName ?? 'model');
  stopping.reset();
  // Tour texte : aucun embed d'image -> le hook fournira des tenseurs vides.
  pendingImage = null;
  prefillDone = false;

  const tokenizer = pipe.tokenizer;
  // Le prompt wire contient déjà <|startoftext|> — pas de BOS supplémentaire.
  const inputs = tokenizer(prompt, { add_special_tokens: false });
  const inputTokens = Number(inputs.input_ids.dims?.at(-1) ?? 0);
  if (debug) {
    // Contrôle in-distribution : premiers ids attendus [1, 6, …] = <|startoftext|><|im_start|>…
    // Un double BOS ([1, 1, …]) ou un BOS manquant signalerait un souci de tokenisation.
    console.log(
      '[souffleurs.worker] adapter=%s device=%s inputTokens=%d firstIds=%o',
      adapter,
      device,
      inputTokens,
      Array.from((inputs.input_ids.data as BigInt64Array).slice(0, 5), Number),
    );
  }

  const t0 = performance.now();
  let tFirst = 0;
  let outputTokens = 0;
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (delta: string) => {
      if (!tFirst) tFirst = performance.now();
      outputTokens++;
      post({ type: 'chunk', id, delta });
    },
  });

  await pipe.model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: false,
    streamer,
    stopping_criteria: stopping,
  });

  const now = performance.now();
  post({
    type: 'done',
    id,
    usage: {
      inputTokens,
      outputTokens,
      ttftMs: Math.round((tFirst || now) - t0),
      durationMs: Math.round(now - t0),
    },
  });
}

/**
 * read_file(image) — le « rôle » vision.
 *
 * MÊME graphe (greffé, bit-identique en texte : écart de logits mesuré 0.000e+00),
 * MÊMES poids `model_q4.onnx_data`. Deux seules différences avec un tour texte :
 *   1. `adapter.data` pointe sur un tampon de ZÉROS -> delta LoRA nul -> base
 *      pristine, celle que la tour a appris à décrire (souffleur-chat, lui, est
 *      entraîné à sortir des tool_calls, ce qui n'a rien à faire ici) ;
 *   2. la tour vision est rattachée en session à part et ses embeds entrent par
 *      `image_features` / `image_indices`.
 * Mécaniquement, c'est donc un swap de souffleur — plus un encodeur détachable.
 * Réseau supplémentaire : la tour, et rien d'autre.
 */
const IMAGE_TOKEN_ID = 396n; // <image>
const IMAGE_START_ID = 498n; // <|image_start|>
const IMAGE_END_ID = 499n; // <|image_end|>

/**
 * Bloc image du prompt — port de `Lfm2VlProcessor._build_image_tokens()`.
 *
 * En mono-tuile : <|image_start|> N×<image> <|image_end|>.
 *
 * En multi-tuiles, chaque tuile est ANNONCÉE par sa position dans la grille,
 * et la vignette d'ensemble ferme la marche :
 *
 *   <|image_start|>
 *     <|img_row_1_col_1|> 256×<image>   <|img_row_1_col_2|> 256×<image>
 *     <|img_row_2_col_1|> 256×<image>   ...
 *     <|img_thumbnail|>   M×<image>
 *   <|image_end|>
 *
 * L'ordre suit celui des tuiles produites par le prétraitement — ligne par
 * ligne, vignette en dernier. Les deux doivent coïncider exactement : les
 * embeds sont posés sur les positions des <image> dans l'ordre où la tour les
 * a produits, donc une inversion ferait décrire au modèle une image
 * recomposée n'importe comment, sans la moindre erreur visible.
 *
 * Ces marqueurs sont de VRAIS tokens de notre vocabulaire (vérifié dans
 * tokenizer.json : <|img_row_R_col_C|>, <|img_thumbnail|>). S'ils n'en
 * étaient pas, ils se découperaient en plusieurs tokens et le prompt sortirait
 * de la distribution d'entraînement sans que rien ne le signale.
 */
function buildImageBlock(image: PreprocessedImage, numTokens: number): string {
  if (image.numTiles <= 1) {
    return '<|image_start|>' + '<image>'.repeat(numTokens) + '<|image_end|>';
  }
  const parts = ['<|image_start|>'];
  const tile = '<image>'.repeat(TOKENS_PER_TILE);
  for (let r = 0; r < image.rows; r++) {
    for (let c = 0; c < image.cols; c++) {
      parts.push(`<|img_row_${r + 1}_col_${c + 1}|>`, tile);
    }
  }
  parts.push(
    '<|img_thumbnail|>',
    '<image>'.repeat(expectedImageTokens(image.width, image.height)),
    '<|image_end|>',
  );
  return parts.join('');
}

async function describeImage(msg: {
  id: number;
  device: ComputeDevice;
  blob: Blob;
  question: string;
  maxNewTokens: number;
  tower: TowerFiles;
  baseWeightsFile: string;
  adapterFile: string;
  modelFileName?: string;
  debug?: boolean;
}): Promise<void> {
  const { id, device, blob, question, maxNewTokens, tower, debug } = msg;
  const modelFileName = msg.modelFileName ?? 'model';
  if (modelFileName === 'model') {
    throw new Error(
      "vision indisponible : le graphe greffé n'est pas publié (bloc `vision` absent du manifest)",
    );
  }

  // 1. Rôle vision = même graphe, adapter neutre. Swap identique aux souffleurs.
  await ensurePipeline(
    id,
    'vision',
    device,
    { baseWeightsFile: msg.baseWeightsFile, adapterFile: msg.adapterFile },
    modelFileName,
    getNeutralAdapter(tower.adapterByteLength),
  );

  // 2. Encodeur détachable, lazy à la 1re image puis gardé chaud.
  const attachMs = await attachTower({
    graphUrl: tower.graphUrl,
    dataUrl: tower.dataUrl,
    internalDataName: tower.internalDataName,
    device,
    onProgress: (loaded, total, file) =>
      post({ type: 'progress', id, file, loaded, total, done: loaded >= total }),
  });
  post({ type: 'ready', id, adapter: 'vision', ms: attachMs });

  // 3. Image -> patches -> embeds.
  const t0 = performance.now();
  const processed = await preprocessImage(blob);
  const { features, numTokens, hiddenSize } = await encodeImage(processed);
  if (debug) {
    const want = expectedTotalTokens(processed);
    const layout =
      processed.numTiles > 1
        ? `${processed.rows}x${processed.cols} tuiles + vignette ${processed.width}x${processed.height}`
        : `${processed.width}x${processed.height}`;
    console.log(
      '[souffleurs.worker] vision %s -> %d tokens (attendu %d) hidden=%d, tour rattachée en %d ms',
      layout, numTokens, want, hiddenSize, attachMs,
    );
    if (want !== numTokens) {
      // Divergence de prétraitement = prompt hors distribution : on veut le voir.
      console.warn('[souffleurs.worker] écart de tokens image : prétraitement à revoir');
    }
  }

  // 4. Prompt au format du chat template VL. Le prompt porte déjà le BOS
  //    -> add_special_tokens: false.
  const tokenizer = pipe.tokenizer;
  const head = `<|startoftext|><|im_start|>user
`;
  const tail = `${question}<|im_end|>
<|im_start|>assistant
`;
  const encoded = tokenizer(head + buildImageBlock(processed, numTokens) + tail, {
    add_special_tokens: false,
  });

  // 5. Positions des tokens <image> -> indices ScatterND [(batch, position), …].
  const ids = encoded.input_ids.data as BigInt64Array;
  const indices = new BigInt64Array(numTokens * 2);
  let found = 0;
  for (let pos = 0; pos < ids.length && found < numTokens; pos++) {
    if (ids[pos] === IMAGE_TOKEN_ID) {
      indices[found * 2] = 0n;
      indices[found * 2 + 1] = BigInt(pos);
      found++;
    }
  }
  if (found !== numTokens) {
    throw new Error(`vision : ${found} tokens <image> pour ${numTokens} embeds`);
  }

  // 6. Génération : le hook injecte les embeds au prefill puis du vide.
  pendingImage = { features, indices, numTokens };
  prefillDone = false;
  stopping.reset();
  let text = '';
  try {
    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (delta: string) => {
        text += delta;
      },
    });
    await pipe.model.generate({
      ...encoded,
      max_new_tokens: maxNewTokens,
      do_sample: false,
      streamer,
      stopping_criteria: stopping,
    });
  } finally {
    pendingImage = null;
  }

  const now = performance.now();
  if (debug) {
    // LE point à regarder pour distinguer « le VL décrit mal » de
    // « souffleur-chat écrase une bonne description ».
    console.log(
      `[souffleurs.worker] DESCRIBE (%d ms, %d tokens image) >>>
%s`,
      Math.round(now - t0),
      numTokens,
      text.trim() || '(vide)',
    );
  }
  // Le texte du describe voyage par le canal `chunk` (une seule salve) : le main
  // thread l'accumule exactement comme une génération de souffleur.
  post({ type: 'chunk', id, delta: text.trim() });
  post({
    type: 'done',
    id,
    usage: {
      inputTokens: ids.length,
      outputTokens: 0,
      ttftMs: Math.round(now - t0),
      durationMs: Math.round(now - t0),
    },
  });
}
