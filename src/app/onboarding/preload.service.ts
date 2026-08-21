/**
 * Préchargement du souffleur au premier lancement — le modèle chat est un
 * prérequis dur (échec = blocage + retry, jamais d'expérience dégradée).
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
      // Deux phases, pondérées par octets pour que la barre ne mente pas :
      // le caller d'abord, la tour vision ensuite (elle fait partie du
      // téléchargement, pas d'une option).
      const towerBytes = await this.towerBytes();
      const callerShare = towerBytes
        ? CALLER_DOWNLOAD_BYTES / (CALLER_DOWNLOAD_BYTES + towerBytes)
        : 1;

      await SouffleursProvider.prepareModel!(CALLER_MODEL_ID, (p) => {
        if (typeof p.progress === 'number') this.progress.set(p.progress * callerShare);
      });
      this.progress.set(100 * callerShare);

      // ATTENDUE, pas en tâche de fond. Sinon `state` passait à 'done' avant
      // que markSeenVision() n'ait tourné, et l'effet du composant rouvrait le
      // modal en boucle (le signal qui clôt le cycle arrivait trop tard).
      await this.prefetchVision((loaded, total) => {
        if (total) {
          this.progress.set(100 * callerShare + (loaded / total) * 100 * (1 - callerShare));
        }
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

  /** Octets de la tour restant à télécharger (0 si absente ou déjà en cache). */
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
   * Tour vision (~269 Mo). Seul le TÉLÉCHARGEMENT est avancé ici ; le
   * rattachement de l'encodeur reste lazy à la première image (ADR-001).
   *
   * `markSeenVision()` est appelé QUOI QU'IL ARRIVE : c'est l'acquittement
   * d'une VERSION, pas un accusé de réception d'octets. Ne l'appeler qu'en cas
   * de succès rendrait le modal insortable dès que le réseau flanche — et la
   * tour sera de toute façon retéléchargée à la première image si elle manque.
   */
  private async prefetchVision(onProgress?: TowerProgress): Promise<void> {
    let manifest: Awaited<ReturnType<typeof getSouffleurManifest>> | null = null;
    try {
      manifest = await getSouffleurManifest();
      const urls = manifest.visionUrls();
      if (!urls) return; // tour non publiée : rien à faire
      await prefetchTower(urls, onProgress);
    } catch (err) {
      console.warn('[onboarding] prefetch de la tour vision échoué (réessai à la 1re image)', err);
    } finally {
      manifest?.markSeenVision();
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
