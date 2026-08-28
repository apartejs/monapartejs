/**
 * Module souffleurs — provider IA local d'aparté (candidat @aparte/provider-souffleurs).
 * Framework-agnostic : aucune dépendance Angular ici.
 */
export {
  SouffleursProvider,
  describeImage,
  detectComputeDevice,
  getLastWire,
  prepareCaller,
  prepareExecutor,
  runExecutor,
  setSouffleurDebug,
  type ExecutorAdapter,
  type ExecutorResult,
} from './souffleurs-provider';
export {
  CALLER_DOWNLOAD_BYTES,
  CALLER_MODEL_ID,
  EXECUTOR_ADAPTERS,
  SIZE_ADAPTER_BYTES,
  SIZE_BASE_BYTES,
  SOUFFLEURS_HF_REPO,
  TOTAL_DOWNLOAD_BYTES,
  type AdapterName,
} from './model-catalog';
export {
  getSouffleurStatus,
  subscribeSouffleurStatus,
  type SouffleurStatus,
  type SouffleurStatusState,
} from './status';
export {
  adapterRole,
  getSouffleurManifest,
  SouffleurManifestClient,
  type SouffleurRole,
  type SouffleursManifest,
} from './manifest';
export {
  isTowerCached,
  prefetchTower,
  TOWER_CACHE,
  type TowerProgress,
} from './vision/tower-cache';
export { buildSystemPrompt, type SouffleurFileRef } from './wire/system-prompt';
export { SOUFFLEUR_TOOL_NAMES } from './wire/tool-defs';
export {
  normalizeAskQuestionInput,
  SOUFFLEUR_ASK_QUESTION_TOOL_NAME,
  souffleurAskQuestionHandler,
  souffleurAskQuestionTool,
} from './tools/ask-question.adapter';
export {
  extType,
  fileRegistry,
  setConversationResolver,
  setFileStore,
  type FileStore,
  type RegisteredFile,
} from './files/file-registry';
export { readFileHandler, readFileTool } from './tools/read-file.tool';
export { writeFileHandler, writeFileTool } from './tools/write-file.tool';
export { computeHandler, computeTool } from './tools/compute.tool';
export { createWidgetHandler, createWidgetTool } from './tools/create-widget.tool';
export { transformFileHandler, transformFileTool } from './tools/transform-file.tool';
export { listReminders, setReminderHandler, setReminderTool } from './tools/set-reminder.tool';
export {
  setArtifactLoader,
  setArtifactSink,
  triggerDownload,
  type ProducedArtifact,
} from './tools/artifact-store';
export {
  artifactCardRenderer,
  installToolRendererStyles,
  invisibleRenderer,
  readFileRenderer,
  widgetRenderer,
} from './tools/tool-renderers';
