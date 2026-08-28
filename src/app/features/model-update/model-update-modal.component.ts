/**
 * Model update modal (equivalent to aimi's aimini-update-modal):
 * shown when the cached weights no longer match the catalog version.
 * Mandatory — no "later" (aimi V0.2 product choice: an outdated caller
 * != contract, the experience would be broken).
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { MascotteComponent } from '../../mascotte';
import { TranslateService } from '../../core/i18n/translate.service';
import { OnboardingPreloadService } from '../../onboarding/preload.service';
import { SIZE_ADAPTER_BYTES, getSouffleurManifest, isTowerCached } from '../../souffleurs';

@Component({
  selector: 'bp-model-update-modal',
  standalone: true,
  imports: [MascotteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop"></div>
    <div class="modal" role="dialog" [attr.aria-label]="t().modelUpdate.title">
      <bp-mascotte [state]="mascotteState()" [size]="56" housed />
      <h2>{{ t().modelUpdate.title }}</h2>
      <p>{{ t().modelUpdate.body }}</p>

      @switch (preload.state()) {
        @case ('running') {
          <div class="progress" role="progressbar" [attr.aria-valuenow]="preload.progress()">
            <div class="bar" [style.width.%]="preload.progress()"></div>
          </div>
          <p class="meta">{{ preload.progress() }} %</p>
        }
        @case ('error') {
          <p class="error">{{ t().modelUpdate.error }}</p>
          <button class="primary" (click)="update()">{{ t().modelUpdate.retry }}</button>
        }
        @default {
          <button class="primary" (click)="update()">{{ actionLabel() }}</button>
        }
      }
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgb(0 0 0 / 45%);
      z-index: 50;
    }
    .modal {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 51;
      width: min(420px, 92vw);
      background: var(--aparte-surface-1);
      border: 1px solid var(--aparte-border);
      border-radius: 16px;
      padding: 28px 26px;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
    }
    h2 {
      margin: 0;
      font-size: 20px;
    }
    p {
      margin: 0;
      color: var(--aparte-text-muted);
      line-height: 1.6;
    }
    .meta {
      font-size: 12px;
    }
    .error {
      color: var(--aparte-error);
    }
    .primary {
      font: inherit;
      background: var(--aparte-primary);
      color: var(--aparte-on-primary, #fff);
      border: none;
      border-radius: 10px;
      padding: 10px 22px;
      cursor: pointer;
    }
    .primary:hover {
      background: var(--aparte-primary-hover);
    }
    .progress {
      width: 100%;
      height: 8px;
      border-radius: 4px;
      background: var(--aparte-surface-3);
      overflow: hidden;
    }
    .bar {
      height: 100%;
      background: var(--aparte-primary);
      transition: width 0.3s ease;
    }
  `,
})
export class ModelUpdateModalComponent {
  protected readonly preload = inject(OnboardingPreloadService);
  private readonly i18n = inject(TranslateService);

  readonly updated = output<void>();

  protected readonly t = this.i18n.t;

  /**
   * Actual weight of the update. Immutable versioned files: the base stays
   * cached, only the adapter changes (~86 MB) — PLUS the vision tower
   * (~269 MB) when it's published and not yet downloaded. Announcing 86 MB
   * while actually pulling 355 would be lying to the user.
   */
  private readonly pendingBytes = signal(SIZE_ADAPTER_BYTES);

  constructor() {
    void this.computePendingBytes();
  }

  private async computePendingBytes(): Promise<void> {
    try {
      const manifest = await getSouffleurManifest();
      const urls = manifest.visionUrls();
      let bytes = manifest.hasUpdate('chat') ? SIZE_ADAPTER_BYTES : 0;
      if (
        urls &&
        manifest.visionHasUpdate() &&
        !(await isTowerCached([urls.graphUrl, urls.dataUrl]))
      ) {
        bytes += manifest.visionSize();
      }
      this.pendingBytes.set(bytes || SIZE_ADAPTER_BYTES);
    } catch {
      /* offline: keep the default estimate */
    }
  }

  protected readonly actionLabel = computed(() =>
    this.t().modelUpdate.action.replace(
      '{size}',
      `${Math.round(this.pendingBytes() / 1_000_000)} Mo`,
    ),
  );

  protected readonly mascotteState = computed(() => {
    switch (this.preload.state()) {
      case 'running':
        return 'thinking' as const;
      case 'error':
        return 'error' as const;
      case 'done':
        return 'happy' as const;
      default:
        return 'wake' as const;
    }
  });

  protected async update(): Promise<void> {
    // No purge: the new .data has a brand-new versioned NAME -> cache miss,
    // natural download, base reused. markSeen is done by the provider on
    // successful load.
    await this.preload.start();
    if (this.preload.state() === 'done') this.updated.emit();
  }
}
