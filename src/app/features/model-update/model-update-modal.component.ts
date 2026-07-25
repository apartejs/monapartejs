/**
 * Modal de mise à jour du modèle (équivalent aimini-update-modal d'aimi) :
 * s'affiche quand les poids en cache ne correspondent plus à la version du
 * catalogue. Obligatoire — pas de « plus tard » (choix produit aimi V0.2 :
 * un caller dépassé ≠ contrat, l'expérience serait cassée).
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { MascotteComponent } from '../../mascotte';
import { TranslateService } from '../../core/i18n/translate.service';
import { OnboardingPreloadService } from '../../onboarding/preload.service';
import { SIZE_ADAPTER_BYTES } from '../../souffleurs';

@Component({
  selector: 'bp-model-update-modal',
  standalone: true,
  imports: [MascotteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop"></div>
    <div class="modal" role="dialog" [attr.aria-label]="t().modelUpdate.title">
      <bp-mascotte [state]="mascotteState()" [size]="56" />
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
    .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 45%); z-index: 50; }
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
    h2 { margin: 0; font-size: 20px; }
    p { margin: 0; color: var(--aparte-text-muted); line-height: 1.6; }
    .meta { font-size: 12px; }
    .error { color: var(--aparte-error); }
    .primary {
      font: inherit;
      background: var(--aparte-primary);
      color: var(--aparte-on-primary, #fff);
      border: none;
      border-radius: 10px;
      padding: 10px 22px;
      cursor: pointer;
    }
    .primary:hover { background: var(--aparte-primary-hover); }
    .progress { width: 100%; height: 8px; border-radius: 4px; background: var(--aparte-surface-3); overflow: hidden; }
    .bar { height: 100%; background: var(--aparte-primary); transition: width 0.3s ease; }
  `,
})
export class ModelUpdateModalComponent {
  protected readonly preload = inject(OnboardingPreloadService);
  private readonly i18n = inject(TranslateService);

  readonly updated = output<void>();

  protected readonly t = this.i18n.t;

  // Fichiers versionnés immuables : seule l'adapter change (~86 Mo), la base
  // reste en cache.
  protected readonly actionLabel = computed(() =>
    this.t().modelUpdate.action.replace(
      '{size}',
      `${Math.round(SIZE_ADAPTER_BYTES / 1_000_000)} Mo`,
    ),
  );

  protected readonly mascotteState = computed(() => {
    switch (this.preload.state()) {
      case 'running': return 'thinking' as const;
      case 'error': return 'error' as const;
      case 'done': return 'happy' as const;
      default: return 'wake' as const;
    }
  });

  protected async update(): Promise<void> {
    // Pas de purge : le nouveau .data a un NOM versionné inédit → cache-miss,
    // téléchargement naturel, base réutilisée. markSeen est fait par le
    // provider au chargement réussi.
    await this.preload.start();
    if (this.preload.state() === 'done') this.updated.emit();
  }
}
