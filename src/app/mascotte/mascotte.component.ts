import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { MARK_BOX, MARK_PATH, MARK_TAIL_PATH } from './mark';
import { MASCOTTE_FACES, type MascotteFace, type MascotteState } from './mascotte-states';

let nextId = 0;

/*
 * Where the face's visual centre sits inside its own 1 em line box, for
 * Georgia's parentheses at `line-height: 1`: 0.554 em. Georgia's ascent and
 * descent (0.917 + 0.219) put the baseline 0.849 em down the box, and the
 * parentheses' centre is 0.295 em above the baseline (Chrome's measureText:
 * 0.75 up, 0.16 down). The styles below place the face with it (`.is-housed
 * .core`); 0.6, the first guess, rode 5 % high.
 */

/**
 * Mascot ('.') — typographic, a face made of punctuation. `housed` draws the
 * product mark around it (ADR-013): the house, whose only light is the mascot.
 *
 * Real states, in the manner of aimi's robot: the eyes blink, the mouth flaps
 * while talking, the light breathes while thinking, z's rise while sleeping,
 * the face bounces when happy and jolts when surprised. Everything animated is
 * a transform or an opacity on a small element, and every loop is capped with
 * `steps()`: cheap enough to keep running during the token decode, which is
 * when the mascot talks. It therefore does NOT carry `.bp-decorative`, and the
 * `body.bp-generating` freeze leaves it alone.
 *
 * `interactive` adds the playground: eyes follow the cursor, hover surprises,
 * a click boops (hearts), a cursor gone quiet makes it look around, and a wink
 * or a side glance every 8-15 s. `follow` gives only the eyes.
 */
@Component({
  selector: 'bp-mascotte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="wrap"
      [class.is-housed]="housed()"
      [class.is-interactive]="interactive()"
      [class.is-booped]="booped()"
      [attr.data-state]="effective()"
      [style.font-size.px]="size()"
      (mouseenter)="onEnter()"
      (mouseleave)="onLeave()"
      (click)="boop()"
    >
      @if (housed()) {
        <!-- The house: a body the colour of the surface, the light behind the
             face (a gradient clipped to the walls — it never crosses them), the
             tail that lights up while talking, and the walls in the product's
             accent. The ids are per instance: several houses share a page. -->
        <svg class="house" viewBox="0 0 120 100" aria-hidden="true">
          <defs>
            <radialGradient
              [attr.id]="glowId"
              cx="60"
              cy="52"
              r="60"
              gradientUnits="userSpaceOnUse"
            >
              <stop class="glow-stop" offset="0" stop-opacity="0.55" />
              <stop class="glow-stop" offset="1" stop-opacity="0" />
            </radialGradient>
            <clipPath [attr.id]="clipId"><path [attr.d]="path" /></clipPath>
          </defs>
          <path class="body" [attr.d]="path" />
          <rect
            class="glow"
            [attr.width]="box.width"
            [attr.height]="box.height"
            [attr.fill]="glowFill"
            [attr.clip-path]="clipRef"
          />
          <path class="tail" [attr.d]="tailPath" />
          <path class="walls" [attr.d]="path" />
        </svg>
      }
      <span class="core">
        @if (housed()) {
          <!-- The attic: the gable above the face, where thoughts, z's, a
               question and hearts go. -->
          <span class="attic" aria-hidden="true">
            @switch (effective()) {
              @case ('thinking') {
                <span class="dots">…</span>
              }
              @case ('sleeping') {
                <span class="z z1">z</span><span class="z z2">z</span><span class="z z3">z</span>
              }
              @case ('searching') {
                <span class="question">?</span>
              }
            }
            @if (hearts()) {
              <span class="heart h1">♥</span><span class="heart h2">♥</span>
            }
          </span>
        }
        <span class="face" role="img" [attr.aria-label]="'mascotte aparté, état ' + effective()">
          <span class="paren">(</span
          ><span class="feat" [style.transform]="look()"
            ><span class="eye">{{ face().eyeLeft }}</span
            ><span class="nose">{{ face().nose }}</span
            ><span class="eye">{{ face().eyeRight }}</span></span
          ><span class="paren">)</span>
          <!-- Bare mounts keep the trailing dots and caret; inside the house
               the attic and the light tell the state instead. -->
          @if (face().suffix === 'dots' && !housed()) {
            <span class="dots-out" aria-hidden="true"></span>
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
      transform-origin: 50% 100%;
    }
    .wrap.is-interactive {
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    /* Housed: a box the size of the house, whatever the face's width — a happy
     * face is wider than an idle one, and the layout around must not move.
     * 120/40 by 100/40 (MARK_BOX over MARK_FACE_SIZE, mark.ts): the numbers
     * are written out because ngc needs the styles to be a literal. */
    .wrap.is-housed {
      width: 3em;
      height: 2.5em;
    }
    .house {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .body {
      fill: var(--aparte-surface);
    }
    .walls {
      fill: none;
      stroke: var(--aparte-primary);
      stroke-width: 4;
      stroke-linejoin: round;
      transition: stroke 0.45s ease;
    }
    .glow-stop {
      stop-color: var(--bp-mascotte, var(--aparte-primary));
    }
    /* The light: the mascot's own brass, behind the face. Its level is the
     * state, and it changes by transition. */
    .glow {
      opacity: 0.3;
      transition: opacity 0.45s ease;
      will-change: opacity;
    }
    .tail {
      fill: var(--bp-mascotte, var(--aparte-primary));
      opacity: 0;
      transition: opacity 0.45s ease;
    }
    .core {
      position: relative;
      display: inline-flex;
      justify-content: center;
    }
    /* The face's visual centre on the walls' centre: 59/40 em from the top of
     * the house (MARK_FACE_CENTRE_EM), minus the 0.554 em where that centre
     * sits in the face's own line box (see the note above the component). */
    .is-housed .core {
      position: absolute;
      left: 0;
      right: 0;
      top: 0.921em;
    }
    .attic {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 100%;
      height: 0.72em;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      pointer-events: none;
      font-family: var(--bp-serif);
      font-size: 0.5em;
      line-height: 1;
      color: var(--aparte-text-muted);
    }
    .face {
      font-family: var(--bp-serif);
      color: var(--bp-mascotte, var(--aparte-primary));
      display: inline-flex;
      align-items: baseline;
      white-space: nowrap;
      user-select: none;
      transform-origin: 50% 70%;
      will-change: transform;
    }
    /* As tight as the icons draw it: the SVG text has no letter spacing, and
     * the house is sized for that width (mark.ts). */
    .feat {
      color: var(--bp-mascotte-ink, var(--aparte-text));
      padding: 0 0.02em;
      display: inline-flex;
      align-items: baseline;
      transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
      will-change: transform;
    }
    .eye {
      display: inline-block;
      transform-origin: 50% 60%;
    }
    .nose {
      padding: 0 0.04em;
      transform: translateY(-0.04em);
      transform-origin: 50% 100%;
      display: inline-block;
      will-change: transform;
    }

    /* ── Idle: the eyes blink, nothing else moves. ─────────────────────── */
    .wrap[data-state='idle'] .eye,
    .wrap[data-state='talking'] .eye,
    .wrap[data-state='searching'] .eye {
      animation: bp-mascotte-blink 5s infinite;
    }
    @keyframes bp-mascotte-blink {
      0%,
      96%,
      100% {
        transform: scaleY(1);
      }
      97%,
      99% {
        transform: scaleY(0.1);
      }
    }

    /* ── Thinking: dots in the attic, the eyes look around, the light breathes. */
    .dots {
      animation: bp-mascotte-dots 1.6s steps(4) infinite;
    }
    .wrap[data-state='thinking'] .feat {
      animation: bp-mascotte-search 2.4s ease-in-out infinite;
    }
    .wrap[data-state='thinking'] .glow {
      opacity: 0.65;
      animation: bp-mascotte-breathe 2.6s ease-in-out infinite;
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
    @keyframes bp-mascotte-search {
      0%,
      100% {
        transform: translate(-0.06em, -0.04em);
      }
      25% {
        transform: translate(0.06em, -0.04em);
      }
      50% {
        transform: translate(0.06em, 0.02em);
      }
      75% {
        transform: translate(-0.06em, 0.02em);
      }
    }
    @keyframes bp-mascotte-breathe {
      50% {
        opacity: 0.35;
      }
    }

    /* ── Talking: the mouth flaps at ~13 fps, the light is full, the words
     * leave through the tail. Runs during the decode — hence the steps. ── */
    .wrap[data-state='talking'] .nose {
      animation: bp-mascotte-flap 0.45s steps(6) infinite;
    }
    .wrap[data-state='talking'] .glow {
      opacity: 1;
    }
    .wrap[data-state='talking'] .tail {
      opacity: 0.55;
      animation: bp-mascotte-tail 0.9s steps(6) infinite;
    }
    @keyframes bp-mascotte-flap {
      0%,
      100% {
        transform: translateY(-0.04em) scale(1, 1);
      }
      50% {
        transform: translateY(-0.04em) scale(1.08, 1.4);
      }
    }
    @keyframes bp-mascotte-tail {
      50% {
        opacity: 0.2;
      }
    }

    /* ── Happy: a bounce, the light full. ──────────────────────────────── */
    .wrap[data-state='happy'] .face {
      animation: bp-mascotte-bounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 3;
    }
    .wrap[data-state='happy'] .glow,
    .wrap[data-state='surprised'] .glow {
      opacity: 1;
    }
    @keyframes bp-mascotte-bounce {
      0%,
      100% {
        transform: translateY(0) rotate(0);
      }
      25% {
        transform: translateY(-0.08em) rotate(-3deg);
      }
      50% {
        transform: translateY(-0.12em) rotate(0);
      }
      75% {
        transform: translateY(-0.08em) rotate(3deg);
      }
    }

    /* ── Surprised: a jolt. ─────────────────────────────────────────────── */
    .wrap[data-state='surprised'] .face {
      animation: bp-mascotte-jolt 0.5s ease-out;
    }
    @keyframes bp-mascotte-jolt {
      30% {
        transform: translateY(-0.12em) scale(1.04);
      }
    }

    /* ── Error: red walls, the light off, a shake on the way in. ───────── */
    .wrap[data-state='error'] .walls {
      stroke: var(--aparte-error);
    }
    .wrap[data-state='error'] .glow,
    .wrap[data-state='sleeping'] .glow {
      opacity: 0;
    }
    .wrap[data-state='error'] .face {
      animation: bp-mascotte-shake 0.5s ease-in-out;
    }
    @keyframes bp-mascotte-shake {
      25% {
        transform: translateX(-0.04em) rotate(-1deg);
      }
      75% {
        transform: translateX(0.04em) rotate(1deg);
      }
    }

    /* ── Sleeping: grey walls, the light off, z's rising to the apex. ──── */
    .wrap[data-state='sleeping'] .walls {
      stroke: var(--aparte-text-muted);
    }
    .wrap[data-state='sleeping'] .face,
    .wrap[data-state='sleeping'] .feat {
      color: var(--aparte-text-muted);
    }
    .z {
      position: absolute;
      left: 60%;
      bottom: 0;
      opacity: 0;
      animation: bp-mascotte-zzz 3s ease-in-out infinite;
    }
    .z2 {
      animation-delay: 1s;
      font-size: 0.85em;
    }
    .z3 {
      animation-delay: 2s;
      font-size: 0.7em;
    }
    @keyframes bp-mascotte-zzz {
      0% {
        opacity: 0;
        transform: translate(0, 0) scale(0.6);
      }
      20% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translate(-0.5em, -1.1em) scale(1.2);
      }
    }

    /* ── Wake: a stretch. ───────────────────────────────────────────────── */
    .wrap[data-state='wake'] .face {
      animation: bp-mascotte-wake 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes bp-mascotte-wake {
      0% {
        transform: scale(0.9) rotate(-3deg);
      }
      50% {
        transform: scale(1.06) rotate(2deg);
      }
      100% {
        transform: scale(1) rotate(0);
      }
    }

    /* ── Searching: a question floats, the eyes sweep. ──────────────────── */
    .question {
      animation: bp-mascotte-question 1.4s ease-in-out infinite;
    }
    .wrap[data-state='searching'] .feat {
      animation: bp-mascotte-sweep 1.4s ease-in-out infinite;
    }
    @keyframes bp-mascotte-question {
      0%,
      100% {
        opacity: 0.6;
        transform: translateY(0) rotate(-8deg);
      }
      50% {
        opacity: 1;
        transform: translateY(-0.15em) rotate(8deg);
      }
    }
    @keyframes bp-mascotte-sweep {
      0%,
      100% {
        transform: translateX(-0.06em);
      }
      50% {
        transform: translateX(0.06em);
      }
    }

    /* ── Boop: the whole house is pressed, hearts rise. ─────────────────── */
    .wrap.is-booped {
      animation: bp-mascotte-press 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes bp-mascotte-press {
      20% {
        transform: scale(1.06, 0.94);
      }
      40% {
        transform: scale(0.96, 1.04);
      }
      60% {
        transform: scale(1.02, 0.98);
      }
      100% {
        transform: scale(1);
      }
    }
    .heart {
      position: absolute;
      bottom: 0;
      color: var(--aparte-primary);
      opacity: 0;
      animation: bp-mascotte-heart 1.4s ease-out forwards;
    }
    .h1 {
      left: 30%;
    }
    .h2 {
      left: 58%;
      animation-delay: 0.2s;
    }
    @keyframes bp-mascotte-heart {
      0% {
        opacity: 0;
        transform: translateY(0.4em) scale(0.4);
      }
      20% {
        opacity: 1;
        transform: translateY(0) scale(1.2);
      }
      60% {
        opacity: 1;
        transform: translateY(-0.6em) scale(1);
      }
      100% {
        opacity: 0;
        transform: translateY(-1.2em) scale(0.6);
      }
    }

    /* ── Bare mounts: the old dots and caret outside the parentheses. ──── */
    .dots-out::after {
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
      animation: bp-mascotte-caret 1.05s steps(1) infinite;
    }
    @keyframes bp-mascotte-caret {
      50% {
        opacity: 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .wrap,
      .face,
      .feat,
      .eye,
      .nose,
      .glow,
      .tail,
      .dots,
      .dots-out::after,
      .caret,
      .z,
      .question,
      .heart {
        animation: none !important;
      }
    }
  `,
})
export class MascotteComponent {
  readonly state = input<MascotteState>('idle');
  readonly size = input<number>(32);
  /** The playground: cursor, hover, click, micro-expressions. */
  readonly interactive = input(false, { transform: booleanAttribute });
  /** Only the eyes follow the cursor — for a mount that cannot be clicked. */
  readonly follow = input(false, { transform: booleanAttribute });
  /**
   * Draw the house around the face — the product mark (ADR-013).
   * `booleanAttribute` so it can be written bare, like any HTML boolean: a bare
   * attribute hands the template a '', which a plain boolean input rejects.
   */
  readonly housed = input(false, { transform: booleanAttribute });

  protected readonly path = MARK_PATH;
  protected readonly tailPath = MARK_TAIL_PATH;
  protected readonly box = MARK_BOX;
  protected readonly glowId = `bp-mascotte-glow-${nextId}`;
  protected readonly clipId = `bp-mascotte-clip-${nextId++}`;
  protected readonly glowFill = `url(#${this.glowId})`;
  protected readonly clipRef = `url(#${this.clipId})`;

  protected readonly booped = signal(false);
  protected readonly hearts = signal(false);
  private readonly hovered = signal(false);
  private readonly cursorGone = signal(false);
  private readonly wink = signal(false);
  private readonly glance = signal(false);
  private readonly lookAt = signal({ x: 0, y: 0 });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private microTimer = 0;
  private microEndTimer = 0;
  private boopTimer = 0;
  private heartTimer = 0;
  private goneTimer = 0;

  /**
   * The state actually shown. The parent's state wins, except when idle: then
   * the playground may surprise (hover) or make it search (cursor gone). A
   * boop makes it happy from any state but sleep and error.
   */
  protected readonly effective = computed<MascotteState>(() => {
    const s = this.state();
    if (this.booped() && s !== 'sleeping' && s !== 'error') return 'happy';
    if (!this.interactive() || s !== 'idle') return s;
    if (this.hovered()) return 'surprised';
    if (this.cursorGone()) return 'searching';
    return s;
  });

  protected readonly face = computed<MascotteFace>(() => {
    const base = MASCOTTE_FACES[this.effective()];
    if (this.wink() && this.effective() === 'idle') return { ...base, eyeRight: '-' };
    return base;
  });

  /** Where the eyes look, as an inline transform on the features. Idle only:
   *  the other states animate the same transform, and an animation wins. */
  protected readonly look = computed(() => {
    if (this.effective() !== 'idle') return null;
    if (this.glance()) return 'translateX(0.08em)';
    const { x, y } = this.lookAt();
    return x || y ? `translate(${x.toFixed(3)}em, ${y.toFixed(3)}em)` : null;
  });

  constructor() {
    // Micro-expression: a wink or a side glance every 8-15 s while idle.
    effect((onCleanup) => {
      clearTimeout(this.microTimer);
      clearTimeout(this.microEndTimer);
      if (this.state() !== 'idle' || !this.interactive()) return;
      const schedule = () => {
        this.microTimer = window.setTimeout(
          () => {
            const winks = Math.random() < 0.5;
            (winks ? this.wink : this.glance).set(true);
            this.microEndTimer = window.setTimeout(
              () => {
                this.wink.set(false);
                this.glance.set(false);
                schedule();
              },
              winks ? 160 : 900,
            );
          },
          8000 + Math.random() * 7000,
        );
      };
      schedule();
      onCleanup(() => {
        clearTimeout(this.microTimer);
        clearTimeout(this.microEndTimer);
      });
    });

    // The eyes follow the cursor. One listener per mount that asks for it,
    // throttled to a frame; the reach is a few hundredths of an em.
    effect((onCleanup) => {
      if (!this.follow() && !this.interactive()) return;
      let frame = 0;
      let last: MouseEvent | null = null;
      const onMove = (e: MouseEvent) => {
        last = e;
        this.cursorGone.set(false);
        clearTimeout(this.goneTimer);
        this.goneTimer = window.setTimeout(() => this.cursorGone.set(true), 4000);
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (last) this.track(last);
          });
        }
      };
      const onLeave = () => {
        this.cursorGone.set(true);
        this.lookAt.set({ x: 0, y: 0 });
      };
      window.addEventListener('mousemove', onMove, { passive: true });
      document.addEventListener('mouseleave', onLeave);
      onCleanup(() => {
        window.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseleave', onLeave);
        cancelAnimationFrame(frame);
        clearTimeout(this.goneTimer);
      });
    });

    this.destroyRef.onDestroy(() => {
      clearTimeout(this.microTimer);
      clearTimeout(this.microEndTimer);
      clearTimeout(this.boopTimer);
      clearTimeout(this.heartTimer);
      clearTimeout(this.goneTimer);
    });
  }

  private track(e: MouseEvent): void {
    const r = this.host.nativeElement.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (!dist) return;
    const reach = (this.interactive() ? 0.07 : 0.04) * Math.min(1, dist / 210);
    this.lookAt.set({ x: (dx / dist) * reach, y: (dy / dist) * reach });
  }

  protected onEnter(): void {
    if (this.interactive()) this.hovered.set(true);
  }

  protected onLeave(): void {
    this.hovered.set(false);
  }

  protected boop(): void {
    if (!this.interactive() || this.booped()) return;
    const s = this.state();
    if (s === 'sleeping' || s === 'error') return;
    this.booped.set(true);
    this.hearts.set(true);
    this.boopTimer = window.setTimeout(() => this.booped.set(false), 600);
    this.heartTimer = window.setTimeout(() => this.hearts.set(false), 1500);
  }
}
