/**
 * Light/dark theme — the data-aparte-theme attribute is set before the first
 * paint by index.html's inline script; this service then handles the switch and persistence.
 */
import { Injectable, signal } from '@angular/core';
import { LOCAL_KEYS, localSet } from '../storage/settings.service';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<Theme>(
    (document.documentElement.getAttribute('data-aparte-theme') as Theme) ?? 'light',
  );

  readonly theme = this._theme.asReadonly();

  toggle(): void {
    this.set(this._theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this._theme.set(theme);
    document.documentElement.setAttribute('data-aparte-theme', theme);
    document.documentElement.style.colorScheme = theme;
    localSet(LOCAL_KEYS.THEME, theme);
  }
}
