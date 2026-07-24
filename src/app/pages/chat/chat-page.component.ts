import { Location } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { AparteChatComponent } from '@aparte/angular';
import type { AparteMessageInfoEventDetail, AparteUsage } from '@aparte/core';
import { ConversationManagerService } from '@aparte/angular';
import { estimateTokens } from '@aparte/engine';
import { GeneratingService } from '../../core/generating.service';
import { TranslateService } from '../../core/i18n/translate.service';
import { ModelStatusService } from '../../core/model-status.service';
import { MascotteComponent } from '../../mascotte';
import { buildSystemPrompt } from '../../souffleurs';
import { SETTINGS_KEYS, SettingsService } from '../../storage/settings.service';
import { ConversationMinimapComponent } from './conversation-minimap.component';

/** Fenêtre de contexte pratique du caller (MAX_SEQ_LEN d'entraînement). */
const CONTEXT_BUDGET_TOKENS = 4096;
const SYSTEM_TOKENS = estimateTokens(buildSystemPrompt(['ask_question']));

@Component({
  selector: 'bp-chat-page',
  standalone: true,
  imports: [AparteChatComponent, MascotteComponent, ConversationMinimapComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat-wrap">
      <aparte-chat
        [conversationId]="conversationId()"
        [placeholder]="t().chat.placeholder"
        [centerWhenEmpty]="true"
        [submitOnEnter]="sendOnEnter()"
        (conversationCreated)="onConversationCreated($event)"
        (typingChange)="onTypingChange($event)"
      >
        <div slot="empty-state" class="welcome">
          <bp-mascotte [state]="'idle'" [size]="110" />
          <h1 class="bp-serif">{{ greeting() }}</h1>
          <p class="tagline bp-serif">{{ t().welcome.tagline }}</p>
          <p class="sub">{{ t().welcome.sub }}</p>
        </div>
        <!-- Présentateur ask_question : OBLIGATOIRE dans le chat (il monte ses
             panneaux dans le composer via showPanel), sinon requestUserInput
             n'a aucun présentateur. Ne rend rien par lui-même. -->
        <aparte-elicitation slot="above-composer"></aparte-elicitation>
        @if (contextTokens(); as ctx) {
          <span
            slot="footer-left"
            class="context-pill"
            [class.warn]="ctx.ratio > 0.75"
            [class.danger]="ctx.ratio > 0.9"
            [title]="t().context.tooltip"
          >
            ≈ {{ ctx.tokens }} / {{ ctx.budget }} · {{ t().context.label }}
          </span>
        }
        <div slot="footer-center" class="helper">{{ t().chat.helper }}</div>
      </aparte-chat>

      <bp-conversation-minimap />

      @if (stats(); as s) {
        <div
          class="stats-pop"
          role="status"
          [style.left.px]="s.x"
          [style.top.px]="s.y"
          (click)="stats.set(null)"
        >
          <p class="stats-title">
            <span class="bp-serif glyph">('.')</span> {{ t().stats.title }}
          </p>
          <dl>
            <div><dt>{{ t().stats.device }}</dt><dd>{{ deviceLabel() }}</dd></div>
            @if (s.usage.outputTokens) {
              <div><dt>{{ t().stats.tokens }}</dt><dd>{{ s.usage.inputTokens }} → {{ s.usage.outputTokens }}</dd></div>
            }
            @if (s.usage.ttftMs !== undefined) {
              <div><dt>{{ t().stats.ttft }}</dt><dd>{{ s.usage.ttftMs }} ms</dd></div>
            }
            @if (speed(s.usage); as v) {
              <div><dt>{{ t().stats.speed }}</dt><dd>{{ v }} tok/s</dd></div>
            }
            @if (s.usage.durationMs !== undefined) {
              <div><dt>{{ t().stats.duration }}</dt><dd>{{ (s.usage.durationMs / 1000).toFixed(1) }} s</dd></div>
            }
          </dl>
        </div>
      }
    </div>
  `,
  styles: `
    /* La lib exige un parent dimensionné (« size the element yourself — a
     * height, or a sized parent », aparte.css). Chaîne bornée + overflow
     * hidden : le SEUL scroll est celui du viewport interne. */
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
      padding: 0 12px;
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
      padding: 4px 0 8px;
    }
    .context-pill {
      font-family: var(--bp-mono);
      font-size: 10.5px;
      color: var(--aparte-text-muted);
      cursor: default;
      white-space: nowrap;
    }
    .context-pill.warn { color: var(--aparte-warning); }
    .context-pill.danger { color: var(--aparte-error); }
    @media (pointer: coarse) {
      .helper { display: none; }
    }

    .stats-pop {
      /* Ancré au bouton « i » de la bulle (coordonnées de l'événement). */
      position: fixed;
      transform: translateY(-100%);
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
    @keyframes bp-pop { from { opacity: 0; transform: translateY(6px); } }
    .stats-title {
      margin: 0 0 8px;
      font-size: 12px;
      font-family: var(--bp-mono);
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--aparte-text-muted);
    }
    .glyph { color: var(--aparte-primary); text-transform: none; letter-spacing: 0; }
    dl { margin: 0; display: grid; gap: 4px; }
    dl div { display: flex; justify-content: space-between; gap: 18px; font-size: 13px; }
    dt { color: var(--aparte-text-muted); }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
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

  protected readonly t = this.i18n.t;
  protected readonly stats = signal<{ usage: AparteUsage; x: number; y: number } | null>(null);

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

  /** Pastille budget contexte (iso context-stats aimi) — estimation lib. */
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
    // SURTOUT PAS router.navigate : '' et 'chat/:id' sont deux routes → le
    // composant serait détruit EN PLEIN STREAM de la première réponse (bug
    // « le premier message ne part pas »). On réécrit l'URL sans navigation ;
    // le wrapper garde déjà le bon id en interne.
    this.location.replaceState(`/chat/${id}`);
  }

  protected onTypingChange(isTyping: boolean): void {
    this.generating.set(isTyping);
    if (isTyping) this.stats.set(null);
  }

  /** Bouton « i » des bulles assistant (aparte-message-info, bubbling) — popover ancré au bouton. */
  @HostListener('window:aparte-message-info', ['$event'])
  protected onMessageInfo(event: Event): void {
    const detail = (event as CustomEvent<AparteMessageInfoEventDetail>).detail;
    if (!detail?.usage) {
      this.stats.set(null);
      return;
    }
    const source = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
    const rect = source?.getBoundingClientRect?.();
    const width = 220;
    const x = Math.max(8, Math.min(rect?.left ?? 16, window.innerWidth - width - 8));
    const y = Math.max(60, (rect?.top ?? window.innerHeight / 2) - 8);
    this.stats.set({ usage: detail.usage, x, y });
  }

  protected speed(usage: AparteUsage): string | null {
    if (!usage.outputTokens || usage.durationMs === undefined) return null;
    const decodeMs = usage.durationMs - (usage.ttftMs ?? 0);
    if (decodeMs <= 0) return null;
    return ((usage.outputTokens / decodeMs) * 1000).toFixed(1);
  }
}
