/**
 * DEBUG page (not linked in the UI): /debug/mascotte
 * Every state of the mascot in the REAL component, without a model: the corner
 * and the onboarding only show a state when the model is in it, and `talking`
 * needs a decode. Light and dark: the topbar's toggle.
 */
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MascotteComponent, type MascotteState } from '../../mascotte';

@Component({
  selector: 'bp-debug-mascotte',
  standalone: true,
  imports: [MascotteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <h2>debug mascotte</h2>
      <p>1 — every state, housed, 64. talking is what the corner shows during the decode</p>
      <div class="row">
        @for (s of states; track s) {
          <figure>
            <bp-mascotte [state]="s" [size]="64" housed />
            <figcaption>{{ s }}</figcaption>
          </figure>
        }
      </div>
      <p>2 — the playground: interactive, 110. eyes, hover, click, a wink every 8-15 s</p>
      <div class="row">
        <bp-mascotte [state]="'idle'" [size]="110" housed interactive />
      </div>
      <p>
        3 — the mounts: sidebar 16 beside the wordmark · model update 56 · corner 64 (follow) ·
        onboarding 72
      </p>
      <div class="row">
        <span class="brand bp-serif">
          <bp-mascotte [state]="'idle'" [size]="16" housed />
          <span>Monaparté</span>
        </span>
        <bp-mascotte [state]="'thinking'" [size]="56" housed />
        <bp-mascotte [state]="'idle'" [size]="64" housed follow />
        <bp-mascotte [state]="'wake'" [size]="72" housed />
      </div>
      <p>4 — bare, at the size of the lib's status line</p>
      <div class="row">
        <bp-mascotte [state]="'thinking'" [size]="22" />
        <bp-mascotte [state]="'talking'" [size]="22" />
        <bp-mascotte [state]="'error'" [size]="22" />
      </div>
    </div>
  `,
  styles: `
    .wrap {
      padding: 24px;
      max-width: 960px;
      margin: 0 auto;
      overflow-y: auto;
      height: 100%;
    }
    p {
      font-family: var(--bp-mono);
      font-size: 12px;
      color: var(--aparte-text-muted);
      margin: 22px 0 6px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 28px;
      padding: 12px 0;
    }
    figure {
      margin: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    figcaption {
      font-family: var(--bp-mono);
      font-size: 11px;
      color: var(--aparte-text-muted);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 600;
    }
  `,
})
export class DebugMascotteComponent {
  protected readonly states: readonly MascotteState[] = [
    'idle',
    'thinking',
    'talking',
    'happy',
    'error',
    'sleeping',
    'wake',
    'surprised',
    'searching',
  ];
}
