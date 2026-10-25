import { SIZE_ADAPTER_BYTES, SIZE_BASE_BYTES } from './model-catalog';
import type { SouffleurManifestClient } from './manifest';

export type UpdateManifest = Pick<
  SouffleurManifestClient,
  'baseHasUpdate' | 'hasUpdate' | 'visionHasUpdate' | 'ggufMmprojFile' | 'ggufSize' | 'visionSize'
>;

/**
 * What an update actually downloads: the chat adapter when its version changed,
 * the base when its revision did (the engine switch changes it: the GGUF base
 * replaces the ONNX one), and the vision encoder when it is new and not cached.
 * Announcing the adapter alone while pulling a gigabyte would be lying.
 */
export async function pendingUpdateBytes(
  manifest: UpdateManifest,
  isCached: (file: string) => Promise<boolean>,
): Promise<number> {
  let bytes = 0;
  if (manifest.baseHasUpdate()) bytes += manifest.ggufSize('base') ?? SIZE_BASE_BYTES;
  if (manifest.hasUpdate('chat')) bytes += manifest.ggufSize('chat') ?? SIZE_ADAPTER_BYTES;
  const mmproj = manifest.ggufMmprojFile();
  if (mmproj && manifest.visionHasUpdate() && !(await isCached(mmproj))) {
    bytes += manifest.visionSize();
  }
  return bytes;
}
