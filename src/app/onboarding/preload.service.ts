/**
 * Preloading the souffleur on first launch — the chat model is a hard
 * prerequisite (failure = blocking + retry, never a degraded experience).
 */
import { Injectable, signal } from '@angular/core';
import {
  CALLER_DOWNLOAD_BYTES,
  CALLER_MODEL_ID,
  EXECUTOR_ADAPTERS,
  SouffleursProvider,
  getSouffleurManifest,
  isTowerCached,
  prefetchTower,
  prepareExecutor,
  prepareCaller,
  type TowerProgress,
} from '../souffleurs';

export type PreloadState = 'idle' | 'running' | 'error' | 'done';

@Injectable({ providedIn: 'root' })
export class OnboardingPreloadService {
  readonly state = signal<PreloadState>('idle');
  readonly progress = signal(0);
  readonly errorMessage = signal<string | null>(null);

  async start(): Promise<void> {
    if (this.state() === 'running') return;
    this.state.set('running');
    this.errorMessage.set(null);
    try {
      // Two phases, weighted by bytes so the bar doesn't lie: the caller
      // first, the vision tower next (it's part of the download, not an
      // option).
      const towerBytes = await this.towerBytes();
      const callerShare = towerBytes
        ? CALLER_DOWNLOAD_BYTES / (CALLER_DOWNLOAD_BYTES + towerBytes)
        : 1;

      await SouffleursProvider.prepareModel!(CALLER_MODEL_ID, (p) => {
        if (typeof p.progress === 'number') this.setProgress(p.progress * callerShare);
      });
      this.setProgress(100 * callerShare);

      // AWAITED, not in the background. Otherwise `state` would move to
      // 'done' before markSeenVision() had run, and the component's effect
      // would reopen the modal in a loop (the signal closing the cycle
      // arrived too late).
      await this.prefetchVision((loaded, total) => {
        if (total) {
          this.setProgress(100 * callerShare + (loaded / total) * 100 * (1 - callerShare));
        }
      });

      this.setProgress(100);
      // ("seen" versions are memorized by the provider via the manifest on
      // every successful load — never a modal after a fresh download)
      this.state.set('done');
      // Executors in best-effort (86 MB each, mirrors aimi's codegen
      // category): a failure never blocks — lazily re-downloaded on first use.
      void this.prefetchExecutors();
    } catch (err) {
      this.state.set('error');
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * The only writer of `progress`. The aggregator hands out whole percentages,
   * but weighting them by the caller's share of the bytes (0.7668…) made
   * 18.404171932196558 %, and the modal printed it as is. Floored, like the
   * aggregator: the bar never claims more than what has arrived.
   */
  private setProgress(value: number): void {
    this.progress.set(Math.floor(value));
  }

  /** Bytes of the tower still to download (0 if absent or already cached). */
  private async towerBytes(): Promise<number> {
    try {
      const manifest = await getSouffleurManifest();
      const urls = manifest.visionUrls();
      if (!urls) return 0;
      if (await isTowerCached([urls.graphUrl, urls.dataUrl])) return 0;
      return manifest.visionSize();
    } catch {
      return 0;
    }
  }

  /**
   * Vision tower (~269 MB). Only the DOWNLOAD is advanced here; attaching
   * the encoder stays lazy until the first image (ADR-001).
   *
   * `markSeenVision()` is called NO MATTER WHAT: it's the acknowledgment of
   * a VERSION, not a receipt for bytes. Calling it only on success would
   * make the modal impossible to dismiss as soon as the network falters —
   * and the tower will be re-downloaded on the first image anyway if it's missing.
   */
  private async prefetchVision(onProgress?: TowerProgress): Promise<void> {
    let manifest: Awaited<ReturnType<typeof getSouffleurManifest>> | null = null;
    try {
      manifest = await getSouffleurManifest();
      const urls = manifest.visionUrls();
      if (!urls) return; // tower not published: nothing to do
      await prefetchTower(urls, onProgress);
    } catch (err) {
      console.warn('[onboarding] vision tower prefetch failed (retrying on the 1st image)', err);
    } finally {
      manifest?.markSeenVision();
    }
  }

  private async prefetchExecutors(): Promise<void> {
    for (const adapter of EXECUTOR_ADAPTERS) {
      try {
        await prepareExecutor(adapter);
      } catch (err) {
        console.warn(`[onboarding] prefetch ${adapter} failed (retrying on first use)`, err);
      }
    }
    // The prefetch leaves the LAST executor in the pipeline: we restore the
    // caller so the first message doesn't pay for a 3.8 s swap.
    try {
      await prepareCaller();
    } catch {
      /* the first chat() call will reload the caller */
    }
  }
}
