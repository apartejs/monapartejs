/**
 * Preloading the souffleur on first launch — the chat model is a hard
 * prerequisite (failure = blocking + retry, never a degraded experience).
 */
import { Injectable, signal } from '@angular/core';
import { aparteGlobalConfig } from '@aparte/core';
import {
  CALLER_DOWNLOAD_BYTES,
  CALLER_MODEL_ID,
  EXECUTOR_ADAPTERS,
  SouffleursProvider,
  adapterRole,
  getSouffleurManifest,
  isFileCached,
  prefetchFile,
  warmCaller,
} from '../souffleurs';

type FileProgress = (loaded: number, total: number) => void;

export type PreloadState = 'idle' | 'running' | 'error' | 'done';

@Injectable({ providedIn: 'root' })
export class OnboardingPreloadService {
  readonly state = signal<PreloadState>('idle');
  readonly progress = signal(0);
  readonly errorMessage = signal<string | null>(null);
  /** The caller's prompt has been sent to the prompt cache this session. */
  private warmed = false;

  async start(): Promise<void> {
    if (this.state() === 'running') return;
    this.state.set('running');
    this.errorMessage.set(null);
    try {
      // Two phases, weighted by bytes so the bar doesn't lie: the caller
      // first, the vision encoder next (it's part of the download, not an
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
      // Then, in the background: the caller's system prompt into the prompt
      // cache (the first message would otherwise pay for the whole tool block),
      // and the executors' files — downloaded only, never loaded, so the warm
      // caller stays in memory. Best-effort: a failure never blocks, an
      // executor is downloaded again on first use.
      void this.warmThenPrefetchExecutors();
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

  /** Bytes of the vision encoder still to download (0 if absent or already cached). */
  private async towerBytes(): Promise<number> {
    try {
      const manifest = await getSouffleurManifest();
      const file = manifest.ggufMmprojFile();
      if (!file || (await isFileCached(file))) return 0;
      return manifest.visionSize();
    } catch {
      return 0;
    }
  }

  /**
   * Vision encoder (mmproj, ~244 MB). Only the DOWNLOAD is advanced here;
   * loading it stays lazy until the first image.
   *
   * `markSeenVision()` is called NO MATTER WHAT: it's the acknowledgment of
   * a VERSION, not a receipt for bytes. Calling it only on success would
   * make the modal impossible to dismiss as soon as the network falters —
   * and the tower will be re-downloaded on the first image anyway if it's missing.
   */
  private async prefetchVision(onProgress?: FileProgress): Promise<void> {
    let manifest: Awaited<ReturnType<typeof getSouffleurManifest>> | null = null;
    try {
      manifest = await getSouffleurManifest();
      const file = manifest.ggufMmprojFile();
      if (!file || (await isFileCached(file))) return; // not published, or already here
      await prefetchFile(file, onProgress);
    } catch (err) {
      console.warn('[onboarding] vision encoder prefetch failed (retrying on the 1st image)', err);
    } finally {
      manifest?.markSeenVision();
    }
  }

  /**
   * A returning user skips the onboarding, so nothing has prefilled the caller's
   * system prompt: their first message would pay for it whole (27 s on the M5's
   * GPU, 89 s on its CPU). Called once the weights are known to be here; at most
   * one warm-up per session, the onboarding's included. Best-effort.
   */
  warmAtBoot(): void {
    if (this.warmed) return;
    this.warmed = true;
    void warmCaller(this.toolNames()).catch((err) => {
      console.warn('[boot] caller warm-up failed (the first message pays the prefill)', err);
    });
  }

  private toolNames(): string[] {
    return aparteGlobalConfig.getTools().map((tool) => tool.name);
  }

  private async warmThenPrefetchExecutors(): Promise<void> {
    this.warmed = true;
    await warmCaller(this.toolNames());
    const manifest = await getSouffleurManifest();
    for (const adapter of EXECUTOR_ADAPTERS) {
      const role = adapterRole(adapter);
      try {
        await prefetchFile(manifest.ggufAdapterFile(role));
        manifest.markSeen(role);
      } catch (err) {
        console.warn(`[onboarding] prefetch ${adapter} failed (retrying on first use)`, err);
      }
    }
  }
}
