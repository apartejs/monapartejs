/**
 * Thème clair/sombre — l'attribut data-aparte-theme est posé avant la première
 * peinture par le script inline d'index.html ; ce service gère la bascule et la
 * persistance ensuite.
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
