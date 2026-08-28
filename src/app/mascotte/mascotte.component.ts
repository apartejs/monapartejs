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
 * The house, in a 142x100 box. The proportions come from what it holds: the
 * face is wide and flat, so the walls are wider than they are tall — but tall
 * enough to read as walls and not as a tent.
 *
 * Their centre sits at y=50, the box's centre, so that centring the drawing on
 * the face lines the two up; the roof therefore rises ABOVE the box (y=-16),
 * which is what `overflow: visible` on the svg is for. Closed — no door, no
 * window. The same silhouette is used by the icons, at their own scale.
 */
const HOUSE_PATH = 'M6 84 L6 16 L71 -16 L136 16 L136 84 Z';

/**
 * Mascot ('.') — typographic, inherits the theme via --aparte-primary.
 * `housed` draws the product mark around it (the home screen and the corner
 * mascot use it; the small mounts stay bare — a house is illegible at 22 px).
 * Interactive: random wink while idle (8-15 s), boop on click.
 * Animations capped with steps(); decorative ones → frozen by
 * `body.bp-generating .bp-decorative` during GPU decoding.
 */
@Component({
  selector: 'bp-mascotte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="wrap"
      [class.is-housed]="housed()"
      [attr.data-state]="state()"
      [style.font-size.px]="size()"
    >
      <span class="core">
        @if (housed()) {
          <!-- The house is the product mark: the mascot at home, on the visitor's
             own device. No door, no window — the only light is inside, and it
             never crosses the walls. Sized in em, so it follows the size input. -->
          <svg class="house" viewBox="0 0 142 100" aria-hidden="true">
            <path class="glow" [attr.d]="housePath" />
            <path class="walls" [attr.d]="housePath" />
          </svg>
        }
        <span
          class="face bp-decorative"
          [class.is-idle]="state() === 'idle' && !booped()"
          [class.is-booped]="booped()"
          [class.is-interactive]="interactive()"
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
          <!-- Inside the house the state is told by the light, so the trailing
               dots and caret are dropped: they hang outside the walls, and the
               face has to stay centred. Bare mounts keep them. -->
          @if (face().suffix === 'dots' && !housed()) {
            <span class="dots" aria-hidden="true"></span>
          }
          @if (face().suffix === 'caret' && !housed()) {
            <span class="caret" aria-hidden="true"></span>
          }
        </span>
      </span>
    </span>
  `,
  styles: `
    :host {
      display: inline-block;
      line-height: 1;
    }
    .wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    /* The house is centred on the FACE, so it hangs off this box, which has no
     * padding of its own; the wrapper reserves the room instead. Centring it on
     * the padded wrapper is what dropped the face to the floor. */
    .core {
      position: relative;
      display: inline-flex;
    }
    /* Room for the house: 3em wide, 2.11em tall, its roof reaching 1.39em above
     * the face's centre and its floor 0.72em below — minus the face's own
     * half-line. */
    .wrap.is-housed {
      padding: 0.89em 0.3em 0.22em;
    }
    .house {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 3em;
      height: 2.11em;
      transform: translate(-50%, -50%);
      pointer-events: none;
      overflow: visible;
    }
    .walls {
      fill: none;
      stroke: var(--aparte-primary);
      stroke-width: 4;
      stroke-linejoin: round;
    }
    /* The light is inside. It changes by TRANSITION, never by a looping
     * animation: body.bp-generating .bp-decorative freezes decorative
     * animations during GPU decoding — that is, exactly while the mascot is
     * thinking or talking, when this light is supposed to be alive. */
    .glow {
      fill: var(--aparte-primary);
      opacity: 0;
      transition: opacity 0.45s ease;
    }
    .wrap[data-state='thinking'] .glow {
      opacity: 0.07;
    }
    .wrap[data-state='talking'] .glow {
      opacity: 0.13;
    }
    .wrap[data-state='error'] .walls {
      stroke: var(--aparte-error);
    }
    .wrap[data-state='sleeping'] .walls {
      stroke: var(--aparte-text-muted);
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
  /** Draw the house around the face — the product mark (ADR-012). */
  readonly housed = input<boolean>(false);

  protected readonly housePath = HOUSE_PATH;

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
    // Micro-expression: random wink every 8-15 s while idle.
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
