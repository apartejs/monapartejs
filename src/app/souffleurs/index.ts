/**
 * Module souffleurs — provider IA local d'aparté (candidat @aparte/provider-souffleurs).
 * Framework-agnostic : aucune dépendance Angular ici.
 */
export {
  SouffleursProvider,
  detectComputeDevice,
  runExecutor,
  type ExecutorAdapter,
  type ExecutorResult,
} from './souffleurs-provider';
export {
  CALLER_DOWNLOAD_BYTES,
  CALLER_MODEL_ID,
  SIZE_ADAPTER_BYTES,
  SIZE_BASE_BYTES,
  SOUFFLEURS_HF_REPO,
  type AdapterName,
} from './model-catalog';
export {
  getSouffleurStatus,
  subscribeSouffleurStatus,
  type SouffleurStatus,
  type SouffleurStatusState,
} from './status';
export {
  clearVersionMarkers,
  isAdapterStale,
  markAdapterPreloaded,
} from './versions';
export { buildSystemPrompt, type SouffleurFileRef } from './wire/system-prompt';
export { SOUFFLEUR_TOOL_NAMES } from './wire/tool-defs';
export {
  normalizeAskQuestionInput,
  souffleurAskQuestionHandler,
  souffleurAskQuestionTool,
} from './tools/ask-question.adapter';
export { extType, fileRegistry, type RegisteredFile } from './files/file-registry';
export { readFileHandler, readFileTool } from './tools/read-file.tool';
