/**
 * Préchargement du souffleur au premier lancement — le modèle chat est un
 * prérequis dur (échec = blocage + retry, jamais d'expérience dégradée).
 */
import { Injectable, signal } from '@angular/core';
import { CALLER_MODEL_ID, SouffleursProvider } from '../souffleurs';

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
      await SouffleursProvider.prepareModel!(CALLER_MODEL_ID, (p) => {
        if (typeof p.progress === 'number') this.progress.set(p.progress);
      });
      this.progress.set(100);
      this.state.set('done');
    } catch (err) {
      this.state.set('error');
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
    }
  }
}
