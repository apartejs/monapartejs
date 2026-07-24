import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { AparteChatComponent } from '@aparte/angular';
import { GeneratingService } from '../../core/generating.service';
import { TranslateService } from '../../core/i18n/translate.service';
import { MascotteComponent } from '../../mascotte';
import { SETTINGS_KEYS, SettingsService } from '../../storage/settings.service';

@Component({
  selector: 'bp-chat-page',
  standalone: true,
  imports: [AparteChatComponent, MascotteComponent],
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
        <div slot="footer-center" class="helper">{{ t().chat.helper }}</div>
      </aparte-chat>
    </div>
  `,
  styles: `
    .chat-wrap {
      height: 100%;
      display: flex;
      flex-direction: column;
      max-width: var(--bp-content-max-width);
      margin: 0 auto;
      width: 100%;
      padding: 0 12px;
    }
    aparte-chat {
      flex: 1;
      min-height: 0;
      display: block;
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
  `,
})
export class ChatPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly i18n = inject(TranslateService);
  private readonly settings = inject(SettingsService);
  private readonly generating = inject(GeneratingService);

  protected readonly t = this.i18n.t;

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

  protected onConversationCreated(id: string): void {
    void this.router.navigate(['/chat', id], { replaceUrl: true });
  }

  protected onTypingChange(isTyping: boolean): void {
    this.generating.set(isTyping);
  }
}
