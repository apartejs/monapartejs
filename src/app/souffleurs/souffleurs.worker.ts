/// <reference lib="webworker" />
/**
 * souffleurs inference worker — a single in-memory pipeline.
 * Loading faithful to the lab's validated harness: shared q4 base + LoRA
 * adapter remapped via session_options.externalData; hot-swap = dispose +
 * re-pipeline with another `.data` (the base stays in the browser's Cache API).
 * Generation: greedy, pre-assembled wire prompt (NEVER apply_chat_template —
 * the HF repo's embedded template ignores tool_calls), decode with
 * skip_special_tokens:false to see the tool_call/im_end markers.
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
import { RepetitionGuard } from './wire/repetition-guard';
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
/** Swap key = the adapter FILE (versioned): new version = re-pipeline. */
let currentAdapterFile: string | null = null;
const stopping = new InterruptableStoppingCriteria();

/** Current graph name: the vision graph and the text one are two files. */
let currentModelFile: string | null = null;

/**
 * NEUTRAL adapter for the describe call — zeros, so a null LoRA delta, so the
 * pristine base, which is exactly what the tower learned to describe
 * (souffleur-chat, on the other hand, is trained to output tool_calls: off
 * topic here).
 * Allocated on the client side: ZERO bytes over the network.
 */
let neutralAdapter: Uint8Array | null = null;

function getNeutralAdapter(byteLength: number): Uint8Array {
  if (!neutralAdapter || neutralAdapter.byteLength !== byteLength) {
    neutralAdapter = new Uint8Array(byteLength);
  }
  return neutralAdapter;
}

/**
 * Image embeds for the CURRENT turn. The hook on
 * `prepare_inputs_for_generation` supplies them at PREFILL then passes empty
 * tensors: the indices are only valid for the full sequence, and an empty
 * ScatterND is inert (measured logits gap: 0).
 */
let pendingImage: { features: Float32Array; indices: BigInt64Array; numTokens: number } | null =
  null;
let prefillDone = false;

const HIDDEN = 2048;
const EMPTY_FEATURES = new Tensor('float32', new Float32Array(0), [0, HIDDEN]);
const EMPTY_INDICES = new Tensor('int64', new BigInt64Array(0), [0, 2]);

/**
 * The grafted graph declares `image_features`/`image_indices` as REQUIRED
 * inputs (measured: with a default initializer, ORT classifies them as
 * "overridable initializer" and transformers.js — which picks from
 * `session.inputNames` — never passes them). So they're supplied on every
 * forward, via the single hook called at each step of the generation loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function installImageHook(model: any): void {
  const session = model.sessions?.['model'];
  if (!session?.inputNames?.includes('image_features')) return; // historical text graph
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
      out.image_indices = new Tensor('int64', pendingImage.indices, [pendingImage.numTokens, 2]);
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
        await generate(
          msg.id,
          msg.adapter,
          msg.device,
          msg.prompt,
          msg.maxNewTokens,
          msg,
          msg.debug,
        );
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
 * Loads the pipeline for a role. "Role" now includes VISION: it's the same
 * graph and the same weights, only `adapter.data` changes — so a vision swap
 * is EXACTLY a souffleur swap.
 *
 * `adapterData`: path in the repo (versioned souffleur) OR byte buffer
 * (neutral adapter for the describe call, allocated locally).
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
  // Text-only turn: no image embeds -> the hook will provide empty tensors.
  pendingImage = null;
  prefillDone = false;

  const tokenizer = pipe.tokenizer;
  // The wire prompt already contains <|startoftext|> — no extra BOS.
  const inputs = tokenizer(prompt, { add_special_tokens: false });
  const inputTokens = Number(inputs.input_ids.dims?.at(-1) ?? 0);
  if (debug) {
    // In-distribution check: expected first ids [1, 6, …] = <|startoftext|><|im_start|>…
    // A double BOS ([1, 1, …]) or a missing BOS would signal a tokenization issue.
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
  // Greedy decoding can lock into repeating one line forever (see the guard).
  // Cut it short and fail the turn: a looping output is never usable.
  const guard = new RepetitionGuard();
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: false,
    callback_function: (delta: string) => {
      if (!tFirst) tFirst = performance.now();
      outputTokens++;
      guard.push(delta);
      if (guard.tripped) {
        stopping.interrupt();
        return;
      }
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

  if (guard.tripped) {
    post({
      type: 'error',
      id,
      message: `generation looped (${adapter} repeated the same line ${4} times) — stopped after ${outputTokens} tokens`,
    });
    return;
  }

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
 * read_file(image) — the vision "role".
 *
 * SAME graph (grafted, bit-identical in text: measured logits gap 0.000e+00),
 * SAME `model_q4.onnx_data` weights. Only two differences from a text turn:
 *   1. `adapter.data` points to a buffer of ZEROS -> null LoRA delta -> the
 *      pristine base, the one the tower learned to describe (souffleur-chat,
 *      on the other hand, is trained to output tool_calls, which has nothing
 *      to do with this);
 *   2. the vision tower is attached in a separate session and its embeds come
 *      in via `image_features` / `image_indices`.
 * Mechanically, this is therefore a souffleur swap — plus a detachable encoder.
 * Extra network: the tower, and nothing else.
 */
const IMAGE_TOKEN_ID = 396n; // <image>

/**
 * Prompt image block — port of `Lfm2VlProcessor._build_image_tokens()`.
 *
 * Mono-tile: <|image_start|> N×<image> <|image_end|>.
 *
 * In multi-tile, each tile is ANNOUNCED by its position in the grid,
 * and the overall thumbnail closes the sequence:
 *
 *   <|image_start|>
 *     <|img_row_1_col_1|> 256×<image>   <|img_row_1_col_2|> 256×<image>
 *     <|img_row_2_col_1|> 256×<image>   ...
 *     <|img_thumbnail|>   M×<image>
 *   <|image_end|>
 *
 * The order follows that of the tiles produced by preprocessing — row by
 * row, thumbnail last. The two must match exactly: the embeds are placed on
 * the <image> positions in the order the tower produced them, so a swap
 * would make the model describe an image recomposed at random, with no
 * visible error whatsoever.
 *
 * These markers are REAL tokens from our vocabulary (verified in
 * tokenizer.json: <|img_row_R_col_C|>, <|img_thumbnail|>). If they weren't,
 * they would split into multiple tokens and the prompt would fall out of the
 * training distribution without anything signaling it.
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

  // 1. Vision role = same graph, neutral adapter. Swap identical to the souffleurs.
  await ensurePipeline(
    id,
    'vision',
    device,
    { baseWeightsFile: msg.baseWeightsFile, adapterFile: msg.adapterFile },
    modelFileName,
    getNeutralAdapter(tower.adapterByteLength),
  );

  // 2. Detachable encoder, lazy on the 1st image then kept warm.
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
      '[souffleurs.worker] vision %s -> %d tokens (expected %d) hidden=%d, tower attached in %d ms',
      layout,
      numTokens,
      want,
      hiddenSize,
      attachMs,
    );
    if (want !== numTokens) {
      // Preprocessing divergence = prompt out of distribution: we want to see it.
      console.warn('[souffleurs.worker] image token mismatch: preprocessing needs review');
    }
  }

  // 4. Prompt in the VL chat template format. The prompt already carries the BOS
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

  // 5. Positions of the <image> tokens -> ScatterND indices [(batch, position), …].
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

  // 6. Generation: the hook injects the embeds at prefill then empty ones.
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
    // THE point to look at to tell "the VL describes poorly" apart from
    // "souffleur-chat overwrites a good description".
    console.log(
      `[souffleurs.worker] DESCRIBE (%d ms, %d image tokens) >>>
%s`,
      Math.round(now - t0),
      numTokens,
      text.trim() || '(empty)',
    );
  }
  // The describe text travels over the `chunk` channel (a single burst): the
  // main thread accumulates it exactly like a souffleur generation.
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
