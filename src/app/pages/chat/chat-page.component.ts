import { Location } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
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
import { AparteChatComponent } from '@aparte/angular';
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
        <!-- Présentateur ask_question : OBLIGATOIRE dans le chat (il monte ses
             panneaux dans le composer via showPanel), sinon requestUserInput
             n'a aucun présentateur. Ne rend rien par lui-même. -->
        <aparte-elicitation slot="above-composer"></aparte-elicitation>
        <!-- Une seule barre depuis aparté 0.7.0 : les trois emplacements
             footer-left / footer-center / footer-right ont fusionné en
             « toolbar ». La place se décide maintenant par l'ordre du DOM et par
             les marges logiques (cf. .helper plus bas). -->
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
      /* La toolbar d'aparté est une simple ligne flex : sans marge, l'astuce
       * suit l'indicateur de contexte au lieu d'être centrée. « auto » des deux
       * côtés la recentre dans la place restante — logique, donc correct aussi
       * en lecture droite-à-gauche. La toolbar apporte son propre
       * padding : ne pas en rajouter, sinon la ligne grandit. */
      margin-inline: auto;
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
      /* Déroulé SOUS le bouton « i » de la bulle (coordonnées de l'événement).
       * .flip le repasse au-dessus quand il déborderait du bas de fenêtre. */
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
    .stats-pop.flip { transform: translateY(-100%); }
    /* N'anime que l'opacite : animer transform ecrasait le translateY(-100%)
     * de .flip pendant la transition (le popover sautait). */
    @keyframes bp-pop { from { opacity: 0; } }
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
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Le popover est en `position: fixed` : dès que le fil défile il se
    // détacherait de son bouton. Le viewport de la lib scrolle EN INTERNE, donc
    // `window:scroll` ne le voit pas — il faut la phase CAPTURE sur le
    // document, que @HostListener ne sait pas exprimer.
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
    /** true = affiché au-dessus du bouton (déborderait en bas). */
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
    // Les pieces jointes sont enregistrees a l'ENVOI, donc avant que la
    // conversation n'ait un id : on les lui rattache maintenant, sinon elles
    // resteraient « en attente » et le prochain fil vierge les annoncerait au
    // modele comme si l'utilisateur venait de les joindre.
    fileRegistry.adoptPending(id);

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
    // composedPath()[0] = le bouton lui-même : l'événement traverse le shadow
    // DOM de la bulle, `target` y serait l'hôte et l'ancrage sauterait.
    const source = (event.composedPath?.()[0] ?? event.target) as HTMLElement | null;
    const rect = source?.getBoundingClientRect?.();
    const width = 220;
    // Hauteur max du popover (5 lignes + titre) : suffisant pour décider de la
    // bascule sans avoir à mesurer après rendu.
    const height = 190;
    const x = Math.max(8, Math.min(rect?.left ?? 16, window.innerWidth - width - 8));
    const below = (rect?.bottom ?? window.innerHeight / 2) + 6;
    const flip = below + height > window.innerHeight - 8;
    const y = flip ? Math.max(height + 8, (rect?.top ?? 0) - 6) : below;
    this.stats.set({ usage: detail.usage, x, y, flip });
  }

  /**
   * Fermeture du popover : il ne se refermait QUE si on cliquait dessus.
   * `pointerdown` et pas `click` : le clic sur le bouton « i » ouvrirait puis
   * refermerait dans le même geste (l'événement remonte jusqu'au document).
   * Avec pointerdown, l'ordre est fermeture -> ouverture, donc jamais de
   * clignotement, et un second clic sur le « i » le rouvre simplement.
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
