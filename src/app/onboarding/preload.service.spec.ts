/**
 * Regression: the update modal kept looping.
 *
 * `start()` launched the tower in the background (`void this.prefetchVision()`),
 * so `state` moved to 'done' BEFORE `markSeenVision()` had run.
 * The component's effect, which rereads `visionHasUpdate()` as soon as the
 * state is 'done', would then still see a "never seen" tower and reopen the
 * modal — in a loop, without downloading anything more since the cache was
 * already warm.
 *
 * Two invariants locked down here:
 *   1. the tower's version is acknowledged BEFORE the state becomes 'done';
 *   2. it's acknowledged even if the download fails (it's the acknowledgment
 *      of a VERSION, not a receipt for bytes) — otherwise the modal
 *      becomes impossible to dismiss as soon as the network falters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const markSeenVision = vi.fn();
type TowerProgress = (loaded: number, total: number) => void;
const prefetchTower = vi.fn(
  async (_urls?: unknown, _onProgress?: TowerProgress): Promise<void> => undefined,
);
const prepareModel = vi.fn(async (_id: string, onProgress: (p: { progress: number }) => void) => {
  onProgress({ progress: 100 });
});

vi.mock('../souffleurs', () => ({
  CALLER_DOWNLOAD_BYTES: 886_000_000,
  CALLER_MODEL_ID: 'souffleur-chat',
  EXECUTOR_ADAPTERS: [] as string[],
  SouffleursProvider: {
    get prepareModel() {
      return prepareModel;
    },
  },
  getSouffleurManifest: async () => ({
    visionUrls: () => ({ graphUrl: 'https://hf/x.onnx', dataUrl: 'https://hf/x.onnx_data' }),
    visionSize: () => 269_390_206,
    markSeenVision,
  }),
  isTowerCached: async () => false,
  prefetchTower: (...args: unknown[]) => prefetchTower(...(args as [])),
  prepareExecutor: async () => undefined,
  prepareCaller: async () => undefined,
}));

const { OnboardingPreloadService } = await import('./preload.service');

describe('OnboardingPreloadService — tower update cycle', () => {
  let service: InstanceType<typeof OnboardingPreloadService>;

  beforeEach(() => {
    markSeenVision.mockClear();
    prefetchTower.mockClear();
    prefetchTower.mockImplementation(async () => undefined);
    service = new OnboardingPreloadService();
  });

  it("acknowledges the version BEFORE 'done' — otherwise the modal loops again", async () => {
    let stateWhenAcked: string | null = null;
    markSeenVision.mockImplementation(() => {
      stateWhenAcked = service.state();
    });

    await service.start();

    expect(markSeenVision).toHaveBeenCalledTimes(1);
    // The acknowledgment must fall during 'running', not after.
    expect(stateWhenAcked).toBe('running');
    expect(service.state()).toBe('done');
  });

  it('acknowledges even if the tower download fails', async () => {
    prefetchTower.mockImplementation(async () => {
      throw new Error('réseau coupé');
    });

    await service.start();

    expect(markSeenVision).toHaveBeenCalledTimes(1);
    // A tower failure doesn't break the flow: the caller is the only
    // hard prerequisite, the tower will be retried on the first image.
    expect(service.state()).toBe('done');
  });

  it('the tower is awaited, not launched in the background', async () => {
    let towerFinished = false;
    prefetchTower.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      towerFinished = true;
    });

    await service.start();

    expect(towerFinished).toBe(true);
    expect(service.progress()).toBe(100);
  });

  it('the percentage is a whole number, whatever the byte shares', async () => {
    // 886 MB of caller against 269 MB of tower: the caller's share is
    // 0.7668…, and 24 % of it is 18.404171932196558 — what the modal showed.
    const seen: number[] = [];
    prepareModel.mockImplementationOnce(async (_id, onProgress) => {
      onProgress({ progress: 24 });
      seen.push(service.progress());
      onProgress({ progress: 100 });
    });
    prefetchTower.mockImplementation(async (_urls, onProgress) => {
      onProgress?.(1000, 3000);
      seen.push(service.progress());
    });

    await service.start();

    // floor(18.40) during the caller, floor(76.68 + 7.77) during the tower.
    expect(seen).toEqual([18, 84]);
    expect(service.progress()).toBe(100);
  });

  it("caller failure: 'error', and nothing is acknowledged", async () => {
    prepareModel.mockImplementationOnce(async () => {
      throw new Error('poids introuvables');
    });

    await service.start();

    expect(service.state()).toBe('error');
    expect(service.errorMessage()).toContain('poids introuvables');
    expect(markSeenVision).not.toHaveBeenCalled();
  });
});
