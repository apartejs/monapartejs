import { describe, expect, it } from 'vitest';
import { pendingUpdateBytes, type UpdateManifest } from './update-bytes';

const manifest = (over: Partial<UpdateManifest> = {}): UpdateManifest => ({
  baseHasUpdate: () => false,
  hasUpdate: () => false,
  visionHasUpdate: () => false,
  ggufMmprojFile: () => 'gguf/mmproj.gguf',
  ggufSize: (part) =>
    ({ base: 730896256, chat: 88880480, mmproj: 244046400 })[part as string] ?? null,
  visionSize: () => 244046400,
  ...over,
});

describe('pendingUpdateBytes', () => {
  it('an install switching engines downloads the base, the chat adapter and the mmproj', async () => {
    const bytes = await pendingUpdateBytes(
      manifest({ baseHasUpdate: () => true, hasUpdate: () => true, visionHasUpdate: () => true }),
      async () => false,
    );
    expect(bytes).toBe(730896256 + 88880480 + 244046400);
  });

  it('a new chat version alone costs only its adapter', async () => {
    expect(await pendingUpdateBytes(manifest({ hasUpdate: () => true }), async () => false)).toBe(
      88880480,
    );
  });

  it('an mmproj already in the cache is not counted', async () => {
    const bytes = await pendingUpdateBytes(
      manifest({ visionHasUpdate: () => true }),
      async () => true,
    );
    expect(bytes).toBe(0);
  });
});
