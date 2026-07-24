import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { conversationAdapter } from '../../core/aparte.config';
import { TranslateService, type AppLocale } from '../../core/i18n/translate.service';
import { ModelStatusService } from '../../core/model-status.service';
import { ThemeService } from '../../core/theme.service';
import { OnboardingPreloadService } from '../../onboarding/preload.service';
import { CALLER_MODEL_ID, SouffleursProvider } from '../../souffleurs';
import { clearAll, exportAll, importAll } from '../../storage/export-import';
import { SETTINGS_KEYS, SettingsService } from '../../storage/settings.service';

@Component({
  selector: 'bp-settings-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <aside class="sheet" role="dialog" [attr.aria-label]="t().settings.title">
      <header>
        <h2>{{ t().settings.title }}</h2>
        <button class="icon" (click)="close.emit()" [attr.aria-label]="t().settings.close">×</button>
      </header>

      <section>
        <h3>{{ t().settings.theme.label }}</h3>
        <div class="seg">
          <button [class.on]="theme.theme() === 'light'" (click)="theme.set('light')">
            {{ t().settings.theme.light }}
          </button>
          <button [class.on]="theme.theme() === 'dark'" (click)="theme.set('dark')">
            {{ t().settings.theme.dark }}
          </button>
        </div>
      </section>

      <section>
        <h3>{{ t().settings.language.label }}</h3>
        <div class="seg">
          <button [class.on]="i18n.locale() === 'fr'" (click)="setLocale('fr')">Français</button>
          <button [class.on]="i18n.locale() === 'en'" (click)="setLocale('en')">English</button>
        </div>
      </section>

      <section>
        <h3>{{ t().settings.sendOnEnter.label }}</h3>
        <label class="toggle">
          <input
            type="checkbox"
            [checked]="sendOnEnter()"
            (change)="toggleSendOnEnter($event)"
          />
          <span>{{ t().settings.sendOnEnter.sub }}</span>
        </label>
      </section>

      <section>
        <h3>{{ t().settings.model.label }}</h3>
        <p class="meta">
          <span class="dot" [class]="'dot ' + modelStatus.dotClass()"></span>
          {{ modelStatus.state().status }}
          @if (modelStatus.state().progress !== undefined) {
            · {{ modelStatus.state().progress }} %
          }
          @if (modelStatus.state().device) {
            · {{ modelStatus.state().device }}
          }
        </p>
        <div class="row">
          <button class="ghost" (click)="redownload()">{{ t().settings.model.redownload }}</button>
          <button class="ghost danger" (click)="deleteModel()">
            {{ t().settings.model.deleteData }}
          </button>
        </div>
      </section>

      <section>
        <h3>{{ t().settings.data.label }}</h3>
        <div class="row">
          <button class="ghost" (click)="exportData()">{{ t().settings.data.exportBtn }}</button>
          <label class="ghost file-btn">
            {{ t().settings.data.importBtn }}
            <input type="file" accept="application/json" (change)="importData($event)" hidden />
          </label>
          <button class="ghost danger" (click)="clearData()">
            {{ t().settings.data.clearBtn }}
          </button>
        </div>
      </section>
    </aside>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgb(0 0 0 / 35%);
      z-index: 40;
    }
    .sheet {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(380px, 92vw);
      background: var(--aparte-surface-1);
      border-left: 1px solid var(--aparte-border);
      z-index: 41;
      padding: 18px 22px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    header { display: flex; align-items: center; justify-content: space-between; }
    h2 { margin: 0; font-size: 20px; }
    h3 {
      margin: 0 0 8px;
      font-size: 13px;
      font-family: var(--bp-mono);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--aparte-text-muted);
      font-weight: 500;
    }
    .icon {
      background: none;
      border: none;
      font-size: 22px;
      cursor: pointer;
      color: var(--aparte-text-muted);
    }
    .seg { display: inline-flex; border: 1px solid var(--aparte-border); border-radius: 10px; overflow: hidden; }
    .seg button {
      font: inherit;
      background: none;
      border: none;
      padding: 8px 16px;
      cursor: pointer;
      color: var(--aparte-text);
    }
    .seg button.on { background: var(--aparte-primary); color: var(--aparte-on-primary, #fff); }
    .toggle { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; color: var(--aparte-text-muted); }
    .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .ghost {
      font: inherit;
      font-size: 13px;
      background: none;
      border: 1px solid var(--aparte-border);
      color: var(--aparte-text);
      border-radius: 8px;
      padding: 7px 12px;
      cursor: pointer;
    }
    .ghost:hover { background: var(--aparte-surface-2); }
    .ghost.danger { color: var(--aparte-error); border-color: var(--aparte-error); }
    .file-btn { display: inline-block; }
    .meta { display: flex; align-items: center; gap: 6px; color: var(--aparte-text-muted); font-size: 13px; margin: 0 0 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .dot.ok { background: var(--aparte-success); }
    .dot.busy { background: var(--aparte-warning); }
    .dot.error { background: var(--aparte-error); }
    .dot.off { background: var(--aparte-text-muted); }
  `,
})
export class SettingsSheetComponent {
  protected readonly i18n = inject(TranslateService);
  protected readonly theme = inject(ThemeService);
  protected readonly modelStatus = inject(ModelStatusService);
  private readonly settings = inject(SettingsService);
  private readonly preload = inject(OnboardingPreloadService);

  readonly close = output<void>();

  protected readonly t = this.i18n.t;
  protected readonly sendOnEnter = computed(() =>
    this.settings.get<boolean>(SETTINGS_KEYS.SEND_ON_ENTER, true),
  );

  protected setLocale(locale: AppLocale): void {
    this.i18n.setLocale(locale);
  }

  protected toggleSendOnEnter(event: Event): void {
    void this.settings.set(SETTINGS_KEYS.SEND_ON_ENTER, (event.target as HTMLInputElement).checked);
  }

  protected redownload(): void {
    void this.preload.start();
  }

  protected async deleteModel(): Promise<void> {
    await SouffleursProvider.deleteModel?.(CALLER_MODEL_ID);
  }

  protected async exportData(): Promise<void> {
    const dump = await exportAll(conversationAdapter);
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aparte-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  protected async importData(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await importAll(conversationAdapter, JSON.parse(await file.text()));
      alert(this.t().settings.data.imported);
      location.reload();
    } catch {
      alert(this.t().settings.data.importError);
    }
  }

  protected async clearData(): Promise<void> {
    if (!confirm(this.t().settings.data.clearConfirm)) return;
    await clearAll(conversationAdapter);
    location.reload();
  }
}
