/** Pont signals au-dessus du statut du module souffleurs (pastille sidebar, settings). */
import { Injectable, signal } from '@angular/core';
import {
  CALLER_MODEL_ID,
  SouffleursProvider,
  subscribeSouffleurStatus,
  type SouffleurStatusState,
} from '../souffleurs';

@Injectable({ providedIn: 'root' })
export class ModelStatusService {
  private readonly _state = signal<SouffleurStatusState>({ status: 'unknown' });
  readonly state = this._state.asReadonly();

  constructor() {
    subscribeSouffleurStatus((s) => this._state.set(s));
    // Résout l'état initial (cached / not-downloaded) sans charger le modèle.
    void SouffleursProvider.getModelStatus?.(CALLER_MODEL_ID).then((status) => {
      if (this._state().status === 'unknown') {
        this._state.set({ status: status === 'not-downloaded' ? 'not-downloaded' : 'ready' });
      }
    });
  }

  dotClass(): 'ok' | 'busy' | 'error' | 'off' {
    switch (this._state().status) {
      case 'ready':
      case 'generating':
        return 'ok';
      case 'downloading':
      case 'loading':
        return 'busy';
      case 'error':
        return 'error';
      default:
        return 'off';
    }
  }
}
