import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AppUpdateService } from '../../core/app-update.service';
import { TranslateService } from '../../core/i18n/translate.service';

@Component({
  selector: 'bp-update-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updates.updateAvailable() && !updates.dismissed()) {
      <div class="toast" role="status">
        <span class="glyph bp-serif">('o')</span>
        <span class="text">{{ t().update.available }}</span>
        <button class="apply" (click)="updates.apply()">{{ t().update.reload }}</button>
        <button class="dismiss" (click)="updates.dismiss()" aria-label="fermer">×</button>
      </div>
    }
  `,
  styles: `
    .toast {
      position: fixed;
      left: 18px;
      bottom: 18px;
      z-index: 45;
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--aparte-surface-1);
      border: 1px solid var(--aparte-border);
      border-radius: 12px;
      padding: 10px 14px;
      box-shadow: 0 12px 32px -12px rgb(0 0 0 / 30%);
      animation: bp-toast 0.25s ease;
      font-size: 13px;
    }
    @keyframes bp-toast {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
    .glyph {
      color: var(--aparte-primary);
    }
    .apply {
      font: inherit;
      background: var(--aparte-primary);
      color: var(--aparte-on-primary, #fff);
      border: none;
      border-radius: 8px;
      padding: 6px 12px;
      cursor: pointer;
    }
    .dismiss {
      background: none;
      border: none;
      color: var(--aparte-text-muted);
      cursor: pointer;
      font-size: 16px;
      padding: 2px 4px;
    }
  `,
})
export class UpdateToastComponent {
  protected readonly updates = inject(AppUpdateService);
  private readonly i18n = inject(TranslateService);
  protected readonly t = this.i18n.t;
}
