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
import { GeneratingService } from '../../core/generating.service';
import { TranslateService } from '../../core/i18n/translate.service';
import { ModelStatusService } from '../../core/model-status.service';
import { MascotteComponent } from '../../mascotte';
import { SETTINGS_KEYS, SettingsService } from '../../storage/settings.service';

@Component({
  selector: 'bp-chat-page',
  standalone: true,
  imports: [AparteChatComponent, MascotteComponent],
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
        <div slot="footer-center" class="helper">{{ t().chat.helper }}</div>
      </aparte-chat>

      @if (stats(); as s) {
        <div class="stats-pop" role="status" (click)="stats.set(null)">
          <p class="stats-title">
            <span class="bp-serif glyph">('.')</span> {{ t().stats.title }}
          </p>
          <dl>
            <div><dt>{{ t().stats.device }}</dt><dd>{{ deviceLabel() }}</dd></div>
            @if (s.outputTokens) {
              <div><dt>{{ t().stats.tokens }}</dt><dd>{{ s.inputTokens }} → {{ s.outputTokens }}</dd></div>
            }
            @if (s.ttftMs !== undefined) {
              <div><dt>{{ t().stats.ttft }}</dt><dd>{{ s.ttftMs }} ms</dd></div>
            }
            @if (speed(s); as v) {
              <div><dt>{{ t().stats.speed }}</dt><dd>{{ v }} tok/s</dd></div>
            }
            @if (s.durationMs !== undefined) {
              <div><dt>{{ t().stats.duration }}</dt><dd>{{ (s.durationMs / 1000).toFixed(1) }} s</dd></div>
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
    @media (pointer: coarse) {
      .helper { display: none; }
    }

    .stats-pop {
      position: absolute;
      right: 16px;
      bottom: 90px;
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

  protected readonly t = this.i18n.t;
  protected readonly stats = signal<AparteUsage | null>(null);

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

  /** Bouton « i » des bulles assistant (aparte-message-info, bubbling). */
  @HostListener('window:aparte-message-info', ['$event'])
  protected onMessageInfo(event: Event): void {
    const detail = (event as CustomEvent<AparteMessageInfoEventDetail>).detail;
    this.stats.set(detail?.usage ?? null);
  }

  protected speed(usage: AparteUsage): string | null {
    if (!usage.outputTokens || usage.durationMs === undefined) return null;
    const decodeMs = usage.durationMs - (usage.ttftMs ?? 0);
    if (decodeMs <= 0) return null;
    return ((usage.outputTokens / decodeMs) * 1000).toFixed(1);
  }
}
