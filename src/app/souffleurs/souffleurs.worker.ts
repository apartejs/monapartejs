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
  TextStreamer,
  pipeline,
} from '@huggingface/transformers';
import {
  BASE_WEIGHTS_FILE,
  SOUFFLEURS_HF_REPO,
  adapterDataFile,
  type AdapterName,
} from './model-catalog';
import type { ComputeDevice, MainToWorker, WorkerToMain } from './worker-protocol';

const post = (msg: WorkerToMain) => (self as unknown as Worker).postMessage(msg);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipe: any = null;
let currentAdapter: AdapterName | null = null;
const stopping = new InterruptableStoppingCriteria();

self.onmessage = async (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'prepare':
        await ensurePipeline(msg.id, msg.adapter, msg.device);
        break;
      case 'generate':
        await generate(msg.id, msg.adapter, msg.device, msg.prompt, msg.maxNewTokens, msg.debug);
        break;
      case 'abort':
        stopping.interrupt();
        break;
      case 'dispose':
        await pipe?.dispose?.();
        pipe = null;
        currentAdapter = null;
        break;
    }
  } catch (err) {
    const id = 'id' in msg ? msg.id : -1;
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};

async function ensurePipeline(id: number, adapter: AdapterName, device: ComputeDevice): Promise<void> {
  if (pipe && currentAdapter === adapter) {
    post({ type: 'ready', id, adapter, ms: 0 });
    return;
  }
  const t0 = performance.now();
  if (pipe) {
    await pipe.dispose?.();
    pipe = null;
    currentAdapter = null;
  }

  const options = {
    device,
    dtype: 'q4',
    model_file_name: 'model',
    use_external_data_format: false,
    session_options: {
      externalData: [
        { path: 'model_q4.onnx_data', data: BASE_WEIGHTS_FILE },
        { path: 'adapter.data', data: adapterDataFile(adapter) },
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
  currentAdapter = adapter;
  post({ type: 'ready', id, adapter, ms: Math.round(performance.now() - t0) });
}

async function generate(
  id: number,
  adapter: AdapterName,
  device: ComputeDevice,
  prompt: string,
  maxNewTokens: number,
  debug = false,
): Promise<void> {
  await ensurePipeline(id, adapter, device);
  stopping.reset();

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
