/**
 * "Currently generating" state — drives the body.bp-generating class
 * (freezes decorative animations during GPU decoding), the corner mascot and the favicon.
 */
import { Injectable, effect, inject, signal } from '@angular/core';
import { FaviconService } from '../mascotte';

@Injectable({ providedIn: 'root' })
export class GeneratingService {
  private readonly favicon = inject(FaviconService);
  private readonly _generating = signal(false);

  readonly generating = this._generating.asReadonly();

  constructor() {
    effect(() => {
      const on = this._generating();
      document.body.classList.toggle('bp-generating', on);
      this.favicon.set(on ? 'talking' : 'idle');
    });
  }

  set(value: boolean): void {
    this._generating.set(value);
  }
}
