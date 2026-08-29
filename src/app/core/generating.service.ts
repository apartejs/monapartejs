/**
 * "Currently generating" state — drives the body.bp-generating class (freezes
 * decorative animations during GPU decoding; the mascot is exempt, its own
 * animations being cheap by construction), the corner mascot and the favicon.
 * When a generation ends, `celebrating` holds for 1.5 s: the mascot's happy beat.
 */
import { Injectable, effect, inject, signal } from '@angular/core';
import { FaviconService } from '../mascotte';

@Injectable({ providedIn: 'root' })
export class GeneratingService {
  private readonly favicon = inject(FaviconService);
  private readonly _generating = signal(false);
  private readonly _celebrating = signal(false);
  private celebrateTimer = 0;

  readonly generating = this._generating.asReadonly();
  readonly celebrating = this._celebrating.asReadonly();

  constructor() {
    effect(() => {
      const on = this._generating();
      document.body.classList.toggle('bp-generating', on);
      this.favicon.set(on ? 'talking' : this._celebrating() ? 'happy' : 'idle');
    });
  }

  set(value: boolean): void {
    if (!value && this._generating()) {
      this._celebrating.set(true);
      clearTimeout(this.celebrateTimer);
      this.celebrateTimer = window.setTimeout(() => this._celebrating.set(false), 1500);
    }
    this._generating.set(value);
  }
}
