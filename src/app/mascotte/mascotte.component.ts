import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { MASCOTTE_FACES, type MascotteFace, type MascotteState } from './mascotte-states';

/**
 * Mascotte ('.') — typographique, hérite du thème (brass via --aparte-primary).
 * Interactive : clin d'œil aléatoire en idle (8-15 s), boop au clic.
 * Animations plafonnées en steps() ; décoratives → gelées par
 * `body.bp-generating .bp-decorative` pendant le décodage GPU.
 */
@Component({
  selector: 'bp-mascotte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="face bp-decorative"
      [class.is-idle]="state() === 'idle' && !booped()"
      [class.is-booped]="booped()"
      [class.is-interactive]="interactive()"
      [style.font-size.px]="size()"
      role="img"
      [attr.aria-label]="'mascotte aparté, état ' + state()"
      (click)="boop()"
    >
      <span class="paren">(</span
      ><span class="feat"
        ><span class="eye">{{ face().eyeLeft }}</span
        ><span class="nose">{{ face().nose }}</span
        ><span class="eye">{{ face().eyeRight }}</span></span
      ><span class="paren">)</span>
      @if (face().suffix === 'dots') {
        <span class="dots" aria-hidden="true"></span>
      }
      @if (face().suffix === 'caret') {
        <span class="caret" aria-hidden="true"></span>
      }
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
    .face.is-interactive {
      cursor: pointer;
    }
    .face.is-idle {
      animation: bp-mascotte-bob 3.2s steps(24) infinite;
    }
    .face.is-booped {
      animation: bp-mascotte-boop 0.5s steps(10);
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
      0%,
      100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-0.06em);
      }
    }
    @keyframes bp-mascotte-boop {
      0% {
        transform: scale(1);
      }
      40% {
        transform: scale(1.18) rotate(-3deg);
      }
      100% {
        transform: scale(1);
      }
    }
    @keyframes bp-mascotte-dots {
      0% {
        opacity: 0.2;
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0.2;
      }
    }
    @keyframes bp-mascotte-blink {
      50% {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .face.is-idle,
      .face.is-booped,
      .dots::after,
      .caret {
        animation: none;
      }
    }
  `,
})
export class MascotteComponent {
  readonly state = input<MascotteState>('idle');
  readonly size = input<number>(32);
  readonly interactive = input<boolean>(false);

  protected readonly booped = signal(false);
  private readonly wink = signal(false);
  private readonly destroyRef = inject(DestroyRef);
  private winkTimer = 0;
  private boopTimer = 0;

  protected readonly face = computed<MascotteFace>(() => {
    if (this.booped()) return MASCOTTE_FACES['happy'];
    const base = MASCOTTE_FACES[this.state()];
    if (this.wink() && this.state() === 'idle') {
      return { ...base, eyeRight: '-' };
    }
    return base;
  });

  constructor() {
    // Micro-expression : clin d'œil aléatoire toutes les 8-15 s en idle.
    effect((onCleanup) => {
      clearTimeout(this.winkTimer);
      if (this.state() !== 'idle' || !this.interactive()) return;
      const schedule = () => {
        this.winkTimer = window.setTimeout(
          () => {
            this.wink.set(true);
            window.setTimeout(() => {
              this.wink.set(false);
              schedule();
            }, 160);
          },
          8000 + Math.random() * 7000,
        );
      };
      schedule();
      onCleanup(() => clearTimeout(this.winkTimer));
    });
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.winkTimer);
      clearTimeout(this.boopTimer);
    });
  }

  protected boop(): void {
    if (!this.interactive() || this.booped()) return;
    this.booped.set(true);
    this.boopTimer = window.setTimeout(() => this.booped.set(false), 600);
  }
}
