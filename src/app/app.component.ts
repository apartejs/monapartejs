import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConversationManagerService } from '@aparte/angular';
import { GeneratingService } from './core/generating.service';
import { TranslateService } from './core/i18n/translate.service';
import { ModelStatusService } from './core/model-status.service';
import { ThemeService } from './core/theme.service';
import { PrivacySheetComponent } from './features/privacy/privacy-sheet.component';
import { SettingsSheetComponent } from './features/settings/settings-sheet.component';
import { SidebarComponent } from './layout/sidebar/sidebar.component';
import { FaviconService, MascotteComponent } from './mascotte';
import { OnboardingComponent } from './onboarding/onboarding.component';
import { LOCAL_KEYS, localGet } from './storage/settings.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    OnboardingComponent,
    SettingsSheetComponent,
    PrivacySheetComponent,
    MascotteComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  protected readonly manager = inject(ConversationManagerService);
  private readonly i18n = inject(TranslateService);
  private readonly theme = inject(ThemeService);
  private readonly generating = inject(GeneratingService);
  private readonly modelStatus = inject(ModelStatusService);
  private readonly favicon = inject(FaviconService);

  protected readonly t = this.i18n.t;

  protected readonly onboardingOpen = signal(localGet(LOCAL_KEYS.ONBOARDING_SEEN) !== '1');
  protected readonly sidebarOpen = signal(window.innerWidth > 768);
  protected readonly settingsOpen = signal(false);
  protected readonly privacyOpen = signal(false);

  protected readonly topbarTitle = computed(
    () => this.manager.activeConversation()?.title ?? '',
  );

  protected readonly cornerMascotteState = computed(() => {
    if (this.modelStatus.state().status === 'error') return 'error' as const;
    return this.generating.generating() ? ('talking' as const) : ('idle' as const);
  });

  protected readonly showCornerMascotte = computed(
    () => this.manager.activeId() !== null && !this.onboardingOpen(),
  );

  constructor() {
    this.favicon.set('idle');
    // Cache modèle purgé (ou nouveau navigateur) : ré-ouvre l'onboarding même
    // si le flag « vu » est présent — le modèle est un prérequis dur.
    if (!this.onboardingOpen()) {
      setTimeout(() => {
        if (this.modelStatus.state().status === 'not-downloaded') {
          this.onboardingOpen.set(true);
        }
      }, 800);
    }
  }

  protected toggleSidebar(): void {
    this.sidebarOpen.set(!this.sidebarOpen());
  }

  protected toggleTheme(): void {
    this.theme.toggle();
  }

  protected onOnboardingDone(): void {
    this.onboardingOpen.set(false);
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    if (this.settingsOpen()) this.settingsOpen.set(false);
    else if (this.privacyOpen()) this.privacyOpen.set(false);
  }
}
