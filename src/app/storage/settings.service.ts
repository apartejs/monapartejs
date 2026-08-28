/**
 * Signals facade over the persisted settings (Dexie `settings` table)
 * + synchronous localStorage keys (read before paint by index.html).
 */
import { Injectable, computed, signal } from '@angular/core';
import { DexieConversationAdapter } from './conversation-adapter';

/** IndexedDB keys (durable preferences). */
export const SETTINGS_KEYS = {
  NICKNAME: 'nickname',
  SEND_ON_ENTER: 'send-on-enter',
} as const;

/** localStorage keys (synchronous read at boot — theme/language/onboarding). */
export const LOCAL_KEYS = {
  THEME: 'bp.theme',
  LOCALE: 'bp.locale',
  ONBOARDING_SEEN: 'bp.onboarding.seen',
} as const;

export function localGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function localSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function localRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private adapter: DexieConversationAdapter | null = null;
  private readonly _settings = signal<Record<string, unknown>>({});

  readonly settings = computed(() => this._settings());

  async init(adapter: DexieConversationAdapter): Promise<void> {
    this.adapter = adapter;
    this._settings.set(await adapter.getAllSettings());
  }

  /** Reactive read (usable inside a computed()). */
  get<T>(key: string, fallback: T): T {
    const value = this._settings()[key];
    return value === undefined ? fallback : (value as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this._settings.update((s) => ({ ...s, [key]: value }));
    await this.adapter?.setSetting(key, value);
  }

  async delete(key: string): Promise<void> {
    this._settings.update((s) => {
      const { [key]: _removed, ...rest } = s;
      return rest;
    });
    await this.adapter?.deleteSetting(key);
  }
}
