/**
 * i18n minimal signals (port du mécanisme aimi) : `t()` renvoie l'objet complet
 * de la locale courante — usage template : `t().sidebar.newChat`.
 * Bascule aussi la locale des composants aparte (fr ↔ défaut anglais).
 */
import { Injectable, computed, signal } from '@angular/core';
import { AparteConfig, DEFAULT_LOCALE } from '@aparte/core';
import { fr as aparteFr } from '@aparte/locale-fr';
import { currentLocale } from '../aparte.config';
import { LOCAL_KEYS, localSet } from '../../storage/settings.service';
import { EN, FR, type Translations } from './translations';

export type AppLocale = 'fr' | 'en';

@Injectable({ providedIn: 'root' })
export class TranslateService {
  private readonly _locale = signal<AppLocale>(currentLocale());

  readonly locale = computed(() => this._locale());
  readonly t = computed<Translations>(() => (this._locale() === 'fr' ? FR : EN));

  setLocale(locale: AppLocale): void {
    this._locale.set(locale);
    localSet(LOCAL_KEYS.LOCALE, locale);
    document.documentElement.lang = locale;
    AparteConfig.setLocale(locale === 'fr' ? aparteFr : DEFAULT_LOCALE);
  }
}
