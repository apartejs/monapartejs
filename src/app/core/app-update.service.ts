/**
 * App update (Service Worker) — mirrors aimi: poll every 10 min, discreet
 * toast; a plain F5 does NOT switch over (asset consistency), you must
 * activate then reload.
 */
import { ApplicationRef, Injectable, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter, first } from 'rxjs';

const POLL_MS = 10 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);

  readonly updateAvailable = signal(false);
  readonly dismissed = signal(false);

  constructor() {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this.updateAvailable.set(true));

    // Poll once the app is stable (never competes with the model download).
    this.appRef.isStable.pipe(first((stable) => stable)).subscribe(() => {
      setInterval(() => void this.swUpdate.checkForUpdate(), POLL_MS);
    });
  }

  async apply(): Promise<void> {
    await this.swUpdate.activateUpdate();
    location.reload();
  }

  dismiss(): void {
    this.dismissed.set(true);
  }
}
