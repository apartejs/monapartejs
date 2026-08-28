import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { AparteChatComponent, AparteElicitationDirective } from '@aparte/angular';
import type { AparteMessageInfoEventDetail, AparteUsage } from '@aparte/core';
import { ConversationManagerService } from '@aparte/angular';
import { estimateTokens } from '@aparte/engine';
import { GeneratingService } from '../../core/generating.service';
import { TranslateService } from '../../core/i18n/translate.service';
import { ModelStatusService } from '../../core/model-status.service';
import { MascotteComponent } from '../../mascotte';
import { buildSystemPrompt, fileRegistry } from '../../souffleurs';
import { SETTINGS_KEYS, SettingsService } from '../../storage/settings.service';
import { ConversationMinimapComponent } from './conversation-minimap.component';

/** Caller's practical context window (training MAX_SEQ_LEN). */
const CONTEXT_BUDGET_TOKENS = 4096;
const SYSTEM_TOKENS = estimateTokens(buildSystemPrompt(['ask_question']));

@Component({
  selector: 'bp-chat-page',
  standalone: true,
  // `AparteElicitationDirective` rather than CUSTOM_ELEMENTS_SCHEMA: since
  // aparté 0.11 every core element has its Angular directive. The schema used
  // to turn off template checking for ALL unknown tags in the file — a typo
  // on an <aparte-chat> binding would get through.
  imports: [
    AparteChatComponent,
    AparteElicitationDirective,
    MascotteComponent,
    ConversationMinimapComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat-wrap">
      <aparte-chat
        [conversationId]="conversationId()"
        [placeholder]="t().chat.placeholder"
        [centerWhenEmpty]="true"
        [submitOnEnter]="sendOnEnter()"
        attachments
        (conversationCreated)="onConversationCreated($event)"
        (typingChange)="onTypingChange($event)"
      >
        <div slot="empty-state" class="welcome">
          <bp-mascotte [state]="'idle'" [size]="110" />
          <h1 class="bp-serif">{{ greeting() }}</h1>
          <p class="tagline bp-serif">{{ t().welcome.tagline }}</p>
          <p class="sub">{{ t().welcome.sub }}</p>
        </div>
        <!-- ask_question presenter: MANDATORY in the chat (it mounts its
             panels in the composer via showPanel), otherwise requestUserInput
             has no presenter. Renders nothing by itself. -->
        <aparte-elicitation slot="above-composer"></aparte-elicitation>
        <!-- A single bar since aparté 0.7.0: the three slots
             footer-left / footer-center / footer-right merged into a single
             "toolbar". Placement is now decided by DOM order and by
             logical margins (see .helper below). -->
        @if (contextTokens(); as ctx) {
          <span
            slot="toolbar"
            class="context-pill"
            [class.warn]="ctx.ratio > 0.75"
            [class.danger]="ctx.ratio > 0.9"
            [title]="t().context.tooltip"
          >
            ≈ {{ ctx.tokens }} / {{ ctx.budget }} · {{ t().context.label }}
          </span>
        }
        <div slot="toolbar" class="helper">{{ t().chat.helper }}</div>
      </aparte-chat>

      <bp-conversation-minimap />

      @if (stats(); as s) {
        <div
          class="stats-pop"
          [class.flip]="s.flip"
          role="status"
          [style.left.px]="s.x"
          [style.top.px]="s.y"
          (click)="stats.set(null)"
        >
          <p class="stats-title"><span class="bp-serif glyph">('.')</span> {{ t().stats.title }}</p>
          <dl>
            <div>
              <dt>{{ t().stats.device }}</dt>
              <dd>{{ deviceLabel() }}</dd>
            </div>
            @if (s.usage.outputTokens) {
              <div>
                <dt>{{ t().stats.tokens }}</dt>
                <dd>{{ s.usage.inputTokens }} → {{ s.usage.outputTokens }}</dd>
              </div>
            }
            @if (s.usage.ttftMs !== undefined) {
              <div>
                <dt>{{ t().stats.ttft }}</dt>
                <dd>{{ s.usage.ttftMs }} ms</dd>
              </div>
            }
            @if (speed(s.usage); as v) {
              <div>
                <dt>{{ t().stats.speed }}</dt>
                <dd>{{ v }} tok/s</dd>
              </div>
            }
            @if (s.usage.durationMs !== undefined) {
              <div>
                <dt>{{ t().stats.duration }}</dt>
                <dd>{{ (s.usage.durationMs / 1000).toFixed(1) }} s</dd>
              </div>
            }
          </dl>
        </div>
      }
    </div>
  `,
  styles: `
    /* The lib requires a sized parent ("size the element yourself — a
     * height, or a sized parent", aparte.css). Bounded chain + overflow
     * hidden: the ONLY scroll is that of the internal viewport. */
    :host {
      display: block;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .chat-wrap {
      height: 100%;
      max-width: var(--bp-content-max-width);
      margin: 0 auto;
      width: 100%;
      /* The bottom BREATHES. This space used to come from the "padding: 4px 0 8px"
       * of the hint below the composer; the single bar of aparté 0.7.0 brings its
       * own padding, so I removed that one — and the composer ended up stuck
       * to the edge of the screen. It belongs to the layout anyway, not to
       * the hint, which disappears on touch screens. */
      padding: 0 12px 12px;
      position: relative;
    }
    aparte-chat {
      height: 100%;
    }
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      text-align: center;
      padding-bottom: 12px;
    }
    .welcome h1 {
      font-size: clamp(1.6rem, 4vw, 2.2rem);
      margin: 14px 0 0;
    }
    .tagline {
      color: var(--aparte-primary);
      font-style: italic;
      font-size: 1.1rem;
      margin: 0;
    }
    .sub {
      color: var(--aparte-text-muted);
      font-size: 0.92rem;
      max-width: 40ch;
      margin: 4px 0 0;
    }
    .helper {
      font-size: 11px;
      color: var(--aparte-text-muted);
      text-align: center;
      /* aparté's toolbar is a simple flex line: without a margin, the hint
       * follows the context indicator instead of being centered. "auto" on both
       * sides recenters it in the remaining space — logical, so also correct
       * in right-to-left reading. The toolbar brings its own
       * padding: don't add more, or the line grows. */
      margin-inline: auto;
    }
    .context-pill {
      font-family: var(--bp-mono);
      font-size: 10.5px;
      color: var(--aparte-text-muted);
      cursor: default;
      white-space: nowrap;
    }
    .context-pill.warn {
      color: var(--aparte-warning);
    }
    .context-pill.danger {
      color: var(--aparte-error);
    }
    @media (pointer: coarse) {
      .helper {
        display: none;
      }
    }

    .stats-pop {
      /* Unfolds BELOW the bubble's "i" button (event coordinates).
       * .flip puts it back above when it would overflow the bottom of the window. */
      position: fixed;
      z-index: 20;
      background: var(--aparte-surface-1);
      border: 1px solid var(--aparte-border);
      border-radius: 12px;
      padding: 12px 16px;
      box-shadow: 0 12px 32px -12px rgb(0 0 0 / 30%);
      cursor: pointer;
      animation: bp-pop 0.18s ease;
      min-width: 180px;
    }
    .stats-pop.flip {
      transform: translateY(-100%);
    }
    /* Only animates opacity: animating transform used to overwrite the
     * translateY(-100%) of .flip during the transition (the popover jumped). */
    @keyframes bp-pop {
      from {
        opacity: 0;
      }
    }
    .stats-title {
      margin: 0 0 8px;
      font-size: 12px;
      font-family: var(--bp-mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--aparte-text-muted);
    }
    .glyph {
      color: var(--aparte-primary);
      text-transform: none;
      letter-spacing: 0;
    }
    dl {
      margin: 0;
      display: grid;
      gap: 4px;
    }
    dl div {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      font-size: 13px;
    }
    dt {
      color: var(--aparte-text-muted);
    }
    dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class ChatPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly i18n = inject(TranslateService);
  private readonly settings = inject(SettingsService);
  private readonly generating = inject(GeneratingService);
  private readonly modelStatus = inject(ModelStatusService);
  private readonly manager = inject(ConversationManagerService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // The popover is `position: fixed`: as soon as the thread scrolls it would
    // detach from its button. The lib's viewport scrolls INTERNALLY, so
    // `window:scroll` doesn't see it — the CAPTURE phase on the document is
    // needed, which @HostListener can't express.
    const onScroll = () => {
      if (this.stats()) this.stats.set(null);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    this.destroyRef.onDestroy(() =>
      document.removeEventListener('scroll', onScroll, { capture: true }),
    );
  }

  protected readonly t = this.i18n.t;
  protected readonly stats = signal<{
    usage: AparteUsage;
    x: number;
    y: number;
    /** true = shown above the button (would overflow at the bottom). */
    flip: boolean;
  } | null>(null);

  protected readonly conversationId = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('id'))),
    { initialValue: null },
  );

  protected readonly sendOnEnter = computed(() =>
    this.settings.get<boolean>(SETTINGS_KEYS.SEND_ON_ENTER, true),
  );

  protected readonly greeting = computed(() => {
    const greetings = this.t().welcome.greetings;
    const hour = new Date().getHours();
    const base =
      hour < 6
        ? greetings.night
        : hour < 12
          ? greetings.morning
          : hour < 18
            ? greetings.afternoon
            : greetings.evening;
    const nickname = this.settings.get<string>(SETTINGS_KEYS.NICKNAME, '');
    return nickname ? `${base}, ${nickname}` : base;
  });

  protected readonly deviceLabel = computed(() =>
    this.modelStatus.state().device === 'webgpu' ? 'WebGPU' : 'WASM (CPU)',
  );

  /** Context budget pill (iso context-stats aimi) — lib estimate. */
  protected readonly contextTokens = computed(() => {
    const conv = this.manager.activeConversation();
    if (!conv || !conv.messages.length) return null;
    let tokens = SYSTEM_TOKENS;
    for (const message of conv.messages) {
      tokens += estimateTokens(message.content ?? '') + 8;
    }
    return {
      tokens,
      budget: CONTEXT_BUDGET_TOKENS,
      ratio: tokens / CONTEXT_BUDGET_TOKENS,
    };
  });

  protected onConversationCreated(id: string): void {
    // Attachments are registered at SEND time, so before the conversation has
    // an id: we attach them to it now, otherwise they would stay "pending"
    // and the next blank thread would announce them to the model as if the
    // user had just attached them.
    fileRegistry.adoptPending(id);

    // ABSOLUTELY NOT router.navigate: '' and 'chat/:id' are two routes -> the
    // component would be destroyed MID-STREAM of the first response (the
    // "first message doesn't go out" bug). We rewrite the URL without
    // navigation; the wrapper already keeps the right id internally.
    this.location.replaceState(`/chat/${id}`);
  }

  protected onTypingChange(isTyping: boolean): void {
    this.generating.set(isTyping);
    if (isTyping) this.stats.set(null);
  }

  /** Assistant bubbles' "i" button (aparte-message-info, bubbling) — popover anchored to the button. */
  @HostListener('window:aparte-message-info', ['$event'])
  protected onMessageInfo(event: Event): void {
    const detail = (event as CustomEvent<AparteMessageInfoEventDetail>).detail;
    if (!detail?.usage) {
      this.stats.set(null);
      return;
    }
    // composedPath()[0] = the button itself: the event crosses the bubble's
    // shadow DOM, `target` there would be the host and the anchoring would break.
    const source = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
    const rect = source?.getBoundingClientRect?.();
    const width = 220;
    // Max popover height (5 lines + title): enough to decide the flip
    // without having to measure after render.
    const height = 190;
    const x = Math.max(8, Math.min(rect?.left ?? 16, window.innerWidth - width - 8));
    const below = (rect?.bottom ?? window.innerHeight / 2) + 6;
    const flip = below + height > window.innerHeight - 8;
    const y = flip ? Math.max(height + 8, (rect?.top ?? 0) - 6) : below;
    this.stats.set({ usage: detail.usage, x, y, flip });
  }

  /**
   * Closing the popover: it used to close ONLY if you clicked on it.
   * `pointerdown` and not `click`: clicking the "i" button would open then
   * close in the same gesture (the event bubbles up to the document).
   * With pointerdown, the order is close -> open, so never any
   * flickering, and a second click on the "i" simply reopens it.
   */
  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerDown(event: Event): void {
    if (!this.stats()) return;
    const path = event.composedPath?.() ?? [];
    const insidePopover = path.some(
      (n) => n instanceof HTMLElement && n.classList?.contains('stats-pop'),
    );
    if (!insidePopover) this.stats.set(null);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.stats.set(null);
  }

  protected speed(usage: AparteUsage): string | null {
    if (!usage.outputTokens || usage.durationMs === undefined) return null;
    const decodeMs = usage.durationMs - (usage.ttftMs ?? 0);
    if (decodeMs <= 0) return null;
    return ((usage.outputTokens / decodeMs) * 1000).toFixed(1);
  }
}
