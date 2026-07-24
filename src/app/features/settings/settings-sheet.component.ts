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
      <header class="head">
        <h2 class="bp-serif">{{ t().settings.title }}</h2>
        <button class="close" (click)="close.emit()" [attr.aria-label]="t().settings.close">
          ×
        </button>
      </header>

      <p class="eyebrow">{{ t().settings.theme.label }} · {{ t().settings.language.label }}</p>
      <div class="card">
        <div class="row">
          <div class="row-text">
            <span class="label">{{ t().settings.theme.label }}</span>
          </div>
          <div class="seg">
            <button [class.on]="theme.theme() === 'light'" (click)="theme.set('light')">
              ☀ {{ t().settings.theme.light }}
            </button>
            <button [class.on]="theme.theme() === 'dark'" (click)="theme.set('dark')">
              ☾ {{ t().settings.theme.dark }}
            </button>
          </div>
        </div>
        <div class="row">
          <div class="row-text">
            <span class="label">{{ t().settings.language.label }}</span>
          </div>
          <div class="seg">
            <button [class.on]="i18n.locale() === 'fr'" (click)="setLocale('fr')">FR</button>
            <button [class.on]="i18n.locale() === 'en'" (click)="setLocale('en')">EN</button>
          </div>
        </div>
        <div class="row">
          <div class="row-text">
            <span class="label">{{ t().settings.sendOnEnter.label }}</span>
            <span class="sub">{{ t().settings.sendOnEnter.sub }}</span>
          </div>
          <button
            class="switch"
            role="switch"
            [attr.aria-checked]="sendOnEnter()"
            [class.on]="sendOnEnter()"
            (click)="toggleSendOnEnter()"
          >
            <span class="knob"></span>
          </button>
        </div>
      </div>

      <p class="eyebrow">{{ t().settings.model.label }}</p>
      <div class="card">
        <div class="row">
          <div class="row-text">
            <span class="label status-line">
              <span class="dot" [class]="'dot ' + modelStatus.dotClass()"></span>
              {{ statusLabel() }}
              @if (modelStatus.state().progress !== undefined) {
                · {{ modelStatus.state().progress }} %
              }
            </span>
            @if (modelStatus.state().device) {
              <span class="sub">{{ deviceLabel() }}</span>
            }
          </div>
        </div>
        <div class="row actions">
          <button class="btn" (click)="redownload()">{{ t().settings.model.redownload }}</button>
          <button class="btn danger" (click)="deleteModel()">
            {{ t().settings.model.deleteData }}
          </button>
        </div>
      </div>

      <p class="eyebrow">{{ t().settings.data.label }}</p>
      <div class="card">
        <div class="row actions">
          <button class="btn" (click)="exportData()">{{ t().settings.data.exportBtn }}</button>
          <label class="btn">
            {{ t().settings.data.importBtn }}
            <input type="file" accept="application/json" (change)="importData($event)" hidden />
          </label>
        </div>
        <div class="row actions">
          <button class="btn danger wide" (click)="clearData()">
            {{ t().settings.data.clearBtn }}
          </button>
        </div>
      </div>

      <p class="foot bp-serif">( '.' ) aparté</p>
    </aside>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgb(0 0 0 / 40%);
      z-index: 40;
      animation: bp-fade 0.2s ease;
    }
    .sheet {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(400px, 94vw);
      background: var(--aparte-bg);
      border-left: 1px solid var(--aparte-border);
      z-index: 41;
      padding: 20px 24px 28px;
      overflow-y: auto;
      animation: bp-slide 0.25s ease;
      box-shadow: -24px 0 48px -24px rgb(0 0 0 / 25%);
    }
    @keyframes bp-fade { from { opacity: 0; } }
    @keyframes bp-slide { from { transform: translateX(30px); opacity: 0; } }

    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    h2 { margin: 0; font-size: 24px; }
    .close {
      background: none;
      border: none;
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
      color: var(--aparte-text-muted);
      padding: 6px 10px;
      border-radius: 8px;
    }
    .close:hover { background: var(--aparte-surface-2); color: var(--aparte-text); }

    .eyebrow {
      font-family: var(--bp-mono);
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--aparte-text-muted);
      margin: 20px 2px 8px;
    }

    .card {
      background: var(--aparte-surface-1);
      border: 1px solid var(--aparte-border);
      border-radius: 14px;
      overflow: hidden;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 13px 16px;
    }
    .row + .row { border-top: 1px solid var(--aparte-border); }
    .row-text { display: grid; gap: 3px; min-width: 0; }
    .label { font-size: 14px; font-weight: 500; }
    .sub { font-size: 12px; color: var(--aparte-text-muted); line-height: 1.45; }
    .status-line { display: inline-flex; align-items: center; gap: 8px; }

    .seg {
      display: inline-flex;
      background: var(--aparte-surface-2);
      border-radius: 10px;
      padding: 3px;
      flex-shrink: 0;
    }
    .seg button {
      font: inherit;
      font-size: 13px;
      background: none;
      border: none;
      padding: 6px 14px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--aparte-text-muted);
    }
    .seg button.on {
      background: var(--aparte-surface-1);
      color: var(--aparte-text);
      box-shadow: 0 1px 3px rgb(0 0 0 / 12%);
      font-weight: 500;
    }

    .switch {
      width: 42px;
      height: 24px;
      border-radius: 999px;
      background: var(--aparte-surface-3);
      border: none;
      position: relative;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.2s ease;
    }
    .switch.on { background: var(--aparte-primary); }
    .knob {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.2s ease;
      box-shadow: 0 1px 3px rgb(0 0 0 / 25%);
    }
    .switch.on .knob { transform: translateX(18px); }

    .actions { flex-wrap: wrap; justify-content: flex-start; }
    .btn {
      font: inherit;
      font-size: 13px;
      background: var(--aparte-surface-2);
      border: 1px solid var(--aparte-border);
      color: var(--aparte-text);
      border-radius: 9px;
      padding: 8px 14px;
      cursor: pointer;
    }
    .btn:hover { background: var(--aparte-surface-3); }
    .btn.danger { color: var(--aparte-error); }
    .btn.danger:hover { background: color-mix(in srgb, var(--aparte-error) 10%, transparent); }
    .btn.wide { width: 100%; text-align: center; }

    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .dot.ok { background: var(--aparte-success); }
    .dot.busy { background: var(--aparte-warning); }
    .dot.error { background: var(--aparte-error); }
    .dot.off { background: var(--aparte-text-muted); }

    .foot {
      text-align: center;
      color: var(--aparte-text-muted);
      font-size: 13px;
      margin: 26px 0 0;
      opacity: 0.7;
    }
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

  protected readonly statusLabel = computed(() => {
    const labels = this.t().modelStatus;
    switch (this.modelStatus.state().status) {
      case 'ready': return labels.ready;
      case 'generating': return labels.generating;
      case 'downloading': return labels.downloading;
      case 'loading': return labels.loading;
      case 'error': return labels.error;
      case 'not-downloaded': return labels.notDownloaded;
      default: return labels.unknown;
    }
  });

  protected readonly deviceLabel = computed(() =>
    this.modelStatus.state().device === 'webgpu' ? 'WebGPU' : 'WASM (CPU)',
  );

  protected setLocale(locale: AppLocale): void {
    this.i18n.setLocale(locale);
  }

  protected toggleSendOnEnter(): void {
    void this.settings.set(SETTINGS_KEYS.SEND_ON_ENTER, !this.sendOnEnter());
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
