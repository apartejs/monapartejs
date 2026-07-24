/**
 * Mise à jour de l'app (Service Worker) — iso aimi : poll toutes les 10 min,
 * toast discret ; un simple F5 ne bascule PAS (cohérence d'assets), il faut
 * activer puis recharger.
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

    // Poll une fois l'app stable (ne concurrence jamais le téléchargement du modèle).
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
