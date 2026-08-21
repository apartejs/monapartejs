/**
 * Régression : le modal de mise à jour bouclait.
 *
 * `start()` lançait la tour en tâche de fond (`void this.prefetchVision()`),
 * donc `state` passait à 'done' AVANT que `markSeenVision()` n'ait tourné.
 * L'effet du composant, qui relit `visionHasUpdate()` dès que l'état vaut
 * 'done', voyait donc encore une tour « jamais vue » et rouvrait le modal —
 * en boucle, sans plus rien télécharger puisque le cache était déjà chaud.
 *
 * Deux invariants verrouillés ici :
 *   1. la version de la tour est acquittée AVANT que l'état ne vaille 'done' ;
 *   2. elle est acquittée même si le téléchargement échoue (c'est l'acquittement
 *      d'une VERSION, pas un accusé de réception d'octets) — sinon le modal
 *      devient insortable dès que le réseau flanche.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const markSeenVision = vi.fn();
const prefetchTower = vi.fn(async () => undefined);
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

describe('OnboardingPreloadService — cycle de mise à jour de la tour', () => {
  let service: InstanceType<typeof OnboardingPreloadService>;

  beforeEach(() => {
    markSeenVision.mockClear();
    prefetchTower.mockClear();
    prefetchTower.mockImplementation(async () => undefined);
    service = new OnboardingPreloadService();
  });

  it("acquitte la version AVANT 'done' — sinon le modal reboucle", async () => {
    let stateWhenAcked: string | null = null;
    markSeenVision.mockImplementation(() => {
      stateWhenAcked = service.state();
    });

    await service.start();

    expect(markSeenVision).toHaveBeenCalledTimes(1);
    // L'acquittement doit tomber pendant 'running', pas après.
    expect(stateWhenAcked).toBe('running');
    expect(service.state()).toBe('done');
  });

  it('acquitte même si le téléchargement de la tour échoue', async () => {
    prefetchTower.mockImplementation(async () => {
      throw new Error('réseau coupé');
    });

    await service.start();

    expect(markSeenVision).toHaveBeenCalledTimes(1);
    // Un échec de la tour ne casse pas le flux : le caller est le seul
    // prérequis dur, la tour sera retirée à la première image.
    expect(service.state()).toBe('done');
  });

  it('la tour est attendue, pas lancée en tâche de fond', async () => {
    let towerFinished = false;
    prefetchTower.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      towerFinished = true;
    });

    await service.start();

    expect(towerFinished).toBe(true);
    expect(service.progress()).toBe(100);
  });

  it("échec du caller : 'error', et on n'acquitte rien", async () => {
    prepareModel.mockImplementationOnce(async () => {
      throw new Error('poids introuvables');
    });

    await service.start();

    expect(service.state()).toBe('error');
    expect(service.errorMessage()).toContain('poids introuvables');
    expect(markSeenVision).not.toHaveBeenCalled();
  });
});
