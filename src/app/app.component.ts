import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
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
import { ModelUpdateModalComponent } from './features/model-update/model-update-modal.component';
import { SearchPaletteComponent } from './features/search/search-palette.component';
import { UpdateToastComponent } from './features/update-toast/update-toast.component';
import { OnboardingComponent } from './onboarding/onboarding.component';
import { OnboardingPreloadService } from './onboarding/preload.service';
import { getSouffleurManifest } from './souffleurs';
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
    ModelUpdateModalComponent,
    SearchPaletteComponent,
    UpdateToastComponent,
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

  /** Routes /debug/* : jamais d'onboarding ni de modal — harnais de test UI. */
  private readonly debugMode = location.pathname.startsWith('/debug');

  protected readonly onboardingOpen = signal(
    !this.debugMode && localGet(LOCAL_KEYS.ONBOARDING_SEEN) !== '1',
  );
  protected readonly modelUpdateOpen = signal(false);
  protected readonly sidebarOpen = signal(window.innerWidth > 768);
  protected readonly settingsOpen = signal(false);
  protected readonly privacyOpen = signal(false);
  protected readonly searchOpen = signal(false);

  protected readonly topbarTitle = computed(() => this.manager.activeConversation()?.title ?? '');

  /** Mascotte coin branchée sur le cycle RÉEL du modèle (provider souffleurs) :
   *  téléchargement/chargement (dont swap d'exécuteur ~3,8 s) → thinking ;
   *  génération (caller ou exécuteur) → talking ; erreur → (x.x). */
  protected readonly cornerMascotteState = computed(() => {
    switch (this.modelStatus.state().status) {
      case 'error':
        return 'error' as const;
      case 'downloading':
      case 'loading':
        return 'thinking' as const;
      case 'generating':
        return 'talking' as const;
      default:
        return this.generating.generating() ? ('talking' as const) : ('idle' as const);
    }
  });

  protected readonly showCornerMascotte = computed(
    () => this.manager.activeId() !== null && !this.onboardingOpen(),
  );

  private readonly preload = inject(OnboardingPreloadService);
  private readonly callerUpdate = signal<boolean | null>(null);

  constructor() {
    this.favicon.set('idle');
    // Détection de version : le manifest HF (no-store) est comparé aux versions
    // « vues ». Les .data versionnés étant immuables, une MAJ = simple cache-miss.
    this.refreshCallerUpdate();
    // RE-vérifier après chaque préchargement réussi (markSeen vient d'être
    // écrit) — sinon le signal figé du boot rouvre le modal en boucle.
    effect(() => {
      if (this.preload.state() === 'done') this.refreshCallerUpdate();
    });
    // Au boot (une fois le statut réel connu) :
    //  - poids absents (cache purgé, autre navigateur, version bumpée jamais
    //    téléchargée) → onboarding, même si « vu » ;
    //  - poids présents mais manifest annonce une nouvelle version du caller
    //    → modal de mise à jour (consentement).
    effect(() => {
      const status = this.modelStatus.state().status;
      if (this.debugMode || this.onboardingOpen() || this.modelUpdateOpen()) return;
      if (status === 'not-downloaded') {
        this.onboardingOpen.set(true);
      } else if (status === 'ready' && this.callerUpdate() === true) {
        this.modelUpdateOpen.set(true);
      }
    });
  }

  private refreshCallerUpdate(): void {
    void getSouffleurManifest().then((manifest) =>
      // La tour vision fait partie du modèle, pas d'une option : une tour
      // publiée jamais vue doit ouvrir le MÊME modal de mise à jour. Sans ce
      // terme, une install existante ne se voyait jamais rien proposer.
      this.callerUpdate.set(manifest.hasUpdate('chat') || manifest.visionHasUpdate()),
    );
  }

  protected onModelUpdated(): void {
    // Fermeture SYNCHRONE du cycle : sans ça, l'effet revoit ready+update=true
    // avant le refresh async et rouvre le modal.
    this.callerUpdate.set(false);
    this.modelUpdateOpen.set(false);
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
    if (this.searchOpen()) this.searchOpen.set(false);
    else if (this.settingsOpen()) this.settingsOpen.set(false);
    else if (this.privacyOpen()) this.privacyOpen.set(false);
  }

  @HostListener('window:keydown.control.k', ['$event'])
  @HostListener('window:keydown.meta.k', ['$event'])
  protected onSearchShortcut(event: Event): void {
    event.preventDefault();
    if (!this.onboardingOpen()) this.searchOpen.set(!this.searchOpen());
  }
}
