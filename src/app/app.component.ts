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
import { cornerMascotteSize } from './layout/corner-mascotte';
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

  /** /debug/* routes: never onboarding nor a modal — UI test harness. */
  private readonly debugMode = location.pathname.startsWith('/debug');

  protected readonly onboardingOpen = signal(
    !this.debugMode && localGet(LOCAL_KEYS.ONBOARDING_SEEN) !== '1',
  );
  protected readonly modelUpdateOpen = signal(false);
  protected readonly sidebarOpen = signal(window.innerWidth > 768);
  private readonly viewportWidth = signal(window.innerWidth);
  protected readonly settingsOpen = signal(false);
  protected readonly privacyOpen = signal(false);
  protected readonly searchOpen = signal(false);

  protected readonly topbarTitle = computed(() => this.manager.activeConversation()?.title ?? '');

  /** Corner mascot wired to the model's REAL cycle (souffleurs provider):
   *  downloading/loading (including executor swap ~3.8 s) → thinking;
   *  generating (caller or executor) → talking; error → (x.x); and a happy
   *  beat for 1.5 s when a generation ends. */
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
        if (this.generating.generating()) return 'talking' as const;
        return this.generating.celebrating() ? ('happy' as const) : ('idle' as const);
    }
  });

  /** 56, 40, or 0 when the gutter beside the column is too narrow — the
   *  sidebar counts, which is why this is not a media query. */
  protected readonly cornerMascotteSize = computed(() =>
    cornerMascotteSize(this.viewportWidth(), this.sidebarOpen()),
  );

  protected readonly showCornerMascotte = computed(
    () =>
      this.manager.activeId() !== null && !this.onboardingOpen() && this.cornerMascotteSize() > 0,
  );

  @HostListener('window:resize')
  protected onResize(): void {
    this.viewportWidth.set(window.innerWidth);
  }

  private readonly preload = inject(OnboardingPreloadService);
  private readonly callerUpdate = signal<boolean | null>(null);

  constructor() {
    this.favicon.set('idle');
    // Version detection: the HF manifest (no-store) is compared against
    // "seen" versions. Since versioned .data files are immutable, an update
    // is just a cache-miss.
    this.refreshCallerUpdate();
    // RE-check after every successful preload (markSeen was just
    // written) — otherwise boot's frozen signal reopens the modal in a loop.
    effect(() => {
      if (this.preload.state() === 'done') this.refreshCallerUpdate();
    });
    // At boot (once the real status is known):
    //  - weights absent (cache purged, other browser, bumped version never
    //    downloaded) → onboarding, even if "seen";
    //  - weights present but the manifest announces a new caller version
    //    → update modal (consent).
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
      // The vision tower is part of the model, not an option: a published
      // tower never seen must open the SAME update modal. Without this
      // term, an existing install would never be offered anything.
      this.callerUpdate.set(manifest.hasUpdate('chat') || manifest.visionHasUpdate()),
    );
  }

  protected onModelUpdated(): void {
    // SYNCHRONOUS closing of the cycle: without this, the effect sees
    // ready+update=true again before the async refresh and reopens the modal.
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
