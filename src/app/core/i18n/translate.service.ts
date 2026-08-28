/**
 * Minimal i18n signals (port of the aimi mechanism): `t()` returns the full
 * object of the current locale — template usage: `t().sidebar.newChat`.
 * Also switches the aparte components' locale (fr ↔ default English).
 */
import { Injectable, computed, signal } from '@angular/core';
import { aparteGlobalConfig, APARTE_DEFAULT_LOCALE } from '@aparte/core';
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
    aparteGlobalConfig.setLocale(locale === 'fr' ? aparteFr : APARTE_DEFAULT_LOCALE);
  }
}
