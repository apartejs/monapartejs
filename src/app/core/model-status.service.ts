/** Signals bridge over the souffleurs module's status (sidebar dot, settings). */
import { Injectable, computed, signal } from '@angular/core';
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

  /**
   * The caller's prompt has been through the model once this session: the boot
   * warm-up or a first answer ran to its end (loading or generating → ready).
   */
  private readonly answered = signal(false);

  /**
   * Without WebGPU the model runs on the CPU, and prefilling the prompt takes
   * 75–89 s on the M5: say so while the boot warm-up (or, failing it, the first
   * answer) pays for it, then stop — the following turns reuse the prompt cache.
   */
  readonly slowDeviceHint = computed(() => this._state().device === 'wasm' && !this.answered());

  constructor() {
    subscribeSouffleurStatus((s) => {
      const previous = this._state().status;
      if ((previous === 'generating' || previous === 'loading') && s.status === 'ready') {
        this.answered.set(true);
      }
      this._state.set(s);
    });
    // Resolves the initial state (cached / not-downloaded) without loading the model.
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
