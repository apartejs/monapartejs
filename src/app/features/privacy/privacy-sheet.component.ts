import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { MascotteComponent } from '../../mascotte';
import { TranslateService } from '../../core/i18n/translate.service';

@Component({
  selector: 'bp-privacy-sheet',
  standalone: true,
  imports: [MascotteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <aside class="sheet" role="dialog" [attr.aria-label]="t().privacy.title">
      <header>
        <h2><bp-mascotte [state]="'idle'" [size]="20" /> {{ t().privacy.title }}</h2>
        <button class="icon" (click)="close.emit()" [attr.aria-label]="t().privacy.close">×</button>
      </header>
      @for (paragraph of t().privacy.body; track $index) {
        <p>{{ paragraph }}</p>
      }
    </aside>
  `,
  styles: `
    .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 35%); z-index: 40; }
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
    }
    header { display: flex; align-items: center; justify-content: space-between; }
    h2 { margin: 0; font-size: 20px; display: flex; align-items: center; gap: 8px; }
    .icon { background: none; border: none; font-size: 22px; cursor: pointer; color: var(--aparte-text-muted); }
    p { color: var(--aparte-text-muted); line-height: 1.65; }
  `,
})
export class PrivacySheetComponent {
  private readonly i18n = inject(TranslateService);
  readonly close = output<void>();
  protected readonly t = this.i18n.t;
}
