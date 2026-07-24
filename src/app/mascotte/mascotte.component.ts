import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MASCOTTE_FACES, type MascotteState } from './mascotte-states';

/**
 * Mascotte ('.') — typographique, hérite du thème (brass via --aparte-primary).
 * Animations plafonnées en steps() pour ne pas concurrencer le décodage GPU ;
 * décoratives → gelées par `body.bp-generating .bp-decorative` (bob idle).
 */
@Component({
  selector: 'bp-mascotte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="face bp-decorative"
      [class.is-idle]="state() === 'idle'"
      [style.font-size.px]="size()"
      role="img"
      [attr.aria-label]="'mascotte aparté, état ' + state()"
    >
      <span class="paren">(</span
      ><span class="feat"
        ><span class="eye">{{ face().eyeLeft }}</span
        ><span class="nose">{{ face().nose }}</span
        ><span class="eye">{{ face().eyeRight }}</span></span
      ><span class="paren">)</span
      >@if (face().suffix === 'dots') {<span class="dots" aria-hidden="true"></span>}
      @if (face().suffix === 'caret') {<span class="caret" aria-hidden="true"></span>}
    </span>
  `,
  styles: `
    :host {
      display: inline-block;
      line-height: 1;
    }
    .face {
      font-family: var(--bp-serif);
      color: var(--aparte-primary);
      display: inline-flex;
      align-items: baseline;
      white-space: nowrap;
      user-select: none;
    }
    .face.is-idle {
      animation: bp-mascotte-bob 3.2s steps(24) infinite;
    }
    .feat {
      color: var(--aparte-text);
      padding: 0 0.04em;
      display: inline-flex;
      align-items: baseline;
    }
    .nose {
      padding: 0 0.12em;
      transform: translateY(-0.04em);
      display: inline-block;
    }
    .dots::after {
      content: '…';
      color: var(--aparte-text-muted);
      animation: bp-mascotte-dots 1.6s steps(4) infinite;
    }
    .caret {
      width: 0.09em;
      height: 0.62em;
      margin-left: 0.08em;
      background: currentColor;
      align-self: center;
      animation: bp-mascotte-blink 1.05s steps(1) infinite;
    }
    @keyframes bp-mascotte-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-0.06em); }
    }
    @keyframes bp-mascotte-dots {
      0% { opacity: 0.2; }
      50% { opacity: 1; }
      100% { opacity: 0.2; }
    }
    @keyframes bp-mascotte-blink {
      50% { opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .face.is-idle, .dots::after, .caret { animation: none; }
    }
  `,
})
export class MascotteComponent {
  readonly state = input<MascotteState>('idle');
  readonly size = input<number>(32);

  protected readonly face = computed(() => MASCOTTE_FACES[this.state()]);
}
