import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { MascotteComponent } from '../../mascotte';
import { TranslateService } from '../../core/i18n/translate.service';

/**
 * Panneau confidentialité — s'ouvre depuis le badge « 100 % local ».
 * Trois cartes, chacune portée par un glyphe de ponctuation (l'identité :
 * les parenthèses = l'aparté, les apostrophes = la voix, le point = le local).
 */
@Component({
  selector: 'bp-privacy-sheet',
  standalone: true,
  imports: [MascotteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <aside class="sheet" role="dialog" [attr.aria-label]="t().privacy.title">
      <header class="head">
        <button class="close" (click)="close.emit()" [attr.aria-label]="t().privacy.close">
          ×
        </button>
      </header>

      <div class="hero">
        <bp-mascotte [state]="'idle'" [size]="64" />
        <h2 class="bp-serif">{{ t().privacy.title }}</h2>
        <p class="badge">100 % local</p>
      </div>

      <div class="cards">
        @for (paragraph of t().privacy.body; track $index) {
          <div class="card">
            <span class="glyph bp-serif" aria-hidden="true">{{ glyphs[$index] }}</span>
            <p>{{ paragraph }}</p>
          </div>
        }
      </div>

      <p class="foot bp-serif">— rien ne quitte cet appareil.</p>
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
      padding: 14px 24px 28px;
      overflow-y: auto;
      animation: bp-slide 0.25s ease;
      box-shadow: -24px 0 48px -24px rgb(0 0 0 / 25%);
    }
    @keyframes bp-fade {
      from {
        opacity: 0;
      }
    }
    @keyframes bp-slide {
      from {
        transform: translateX(30px);
        opacity: 0;
      }
    }

    .head {
      display: flex;
      justify-content: flex-end;
    }
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
    .close:hover {
      background: var(--aparte-surface-2);
      color: var(--aparte-text);
    }

    .hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      text-align: center;
      padding: 6px 0 22px;
    }
    h2 {
      margin: 4px 0 0;
      font-size: 26px;
    }
    .badge {
      font-family: var(--bp-mono);
      font-size: 11px;
      letter-spacing: 0.1em;
      color: var(--aparte-primary);
      border: 1px solid var(--aparte-primary);
      border-radius: 999px;
      padding: 3px 14px;
      margin: 0;
    }

    .cards {
      display: grid;
      gap: 12px;
    }
    .card {
      background: var(--aparte-surface-1);
      border: 1px solid var(--aparte-border);
      border-radius: 14px;
      padding: 16px 18px;
      display: grid;
      grid-template-columns: 2.2rem 1fr;
      gap: 12px;
      align-items: start;
    }
    .glyph {
      font-size: 1.5rem;
      color: var(--aparte-primary);
      text-align: center;
      line-height: 1.3;
    }
    .card p {
      margin: 0;
      color: var(--aparte-text-muted);
      line-height: 1.65;
      font-size: 13.5px;
    }

    .foot {
      text-align: center;
      color: var(--aparte-text-muted);
      font-style: italic;
      font-size: 13px;
      margin: 24px 0 0;
      opacity: 0.75;
    }
  `,
})
export class PrivacySheetComponent {
  private readonly i18n = inject(TranslateService);
  readonly close = output<void>();
  protected readonly t = this.i18n.t;
  protected readonly glyphs = ['( )', '’ ’', '.'];
}
