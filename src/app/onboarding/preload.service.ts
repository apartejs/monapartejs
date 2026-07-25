/**
 * Préchargement du souffleur au premier lancement — le modèle chat est un
 * prérequis dur (échec = blocage + retry, jamais d'expérience dégradée).
 */
import { Injectable, signal } from '@angular/core';
import {
  CALLER_MODEL_ID,
  EXECUTOR_ADAPTERS,
  SouffleursProvider,
  prepareExecutor,
  prepareCaller,
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
      await SouffleursProvider.prepareModel!(CALLER_MODEL_ID, (p) => {
        if (typeof p.progress === 'number') this.progress.set(p.progress);
      });
      this.progress.set(100);
      // (les versions « vues » sont mémorisées par le provider via le manifest
      // à chaque chargement réussi — jamais de modal après un download frais)
      this.state.set('done');
      // Exécuteurs en best-effort (86 Mo chacun, iso catégorie codegen d'aimi) :
      // un échec ne bloque jamais — retéléchargés paresseusement au premier usage.
      void this.prefetchExecutors();
    } catch (err) {
      this.state.set('error');
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
    }
  }

  private async prefetchExecutors(): Promise<void> {
    for (const adapter of EXECUTOR_ADAPTERS) {
      try {
        await prepareExecutor(adapter);
      } catch (err) {
        console.warn(`[onboarding] prefetch ${adapter} échoué (réessai au premier usage)`, err);
      }
    }
    // Le prefetch laisse le DERNIER exécuteur dans le pipeline : on remet le
    // caller pour que le premier message ne paie pas un swap de 3,8 s.
    try {
      await prepareCaller();
    } catch {
      /* le premier chat() rechargera le caller */
    }
  }
}
