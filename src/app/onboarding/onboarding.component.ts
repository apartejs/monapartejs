/**
 * Onboarding — 3 steps mirroring aimi: local-first intro → download
 * consent (size GENERATED from the catalog, never hardcoded) →
 * preparing/ready. No skip: the model is a hard prerequisite.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { MascotteComponent, type MascotteState } from '../mascotte';
import { TOTAL_DOWNLOAD_BYTES, getSouffleurManifest } from '../souffleurs';
import { TranslateService } from '../core/i18n/translate.service';
import { LOCAL_KEYS, localSet } from '../storage/settings.service';
import { OnboardingPreloadService } from './preload.service';

type StepKind = 'intro' | 'download' | 'ready';

@Component({
  selector: 'bp-onboarding',
  standalone: true,
  imports: [MascotteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="onboarding">
      <div class="card">
        <bp-mascotte [state]="mascotteState()" [size]="72" housed />
        <p class="tag">{{ tag() }}</p>

        @switch (step()) {
          @case ('intro') {
            <h1>{{ t().onboarding.intro.title }}</h1>
            <p class="body">{{ t().onboarding.intro.body }}</p>
            <ul class="bullets">
              @for (b of t().onboarding.intro.bullets; track b.label) {
                <li>
                  <b>{{ b.label }}</b>
                  <span>{{ b.sub }}</span>
                </li>
              }
            </ul>
            <button class="primary" (click)="step.set('download')">
              {{ t().onboarding.intro.next }}
            </button>
          }
          @case ('download') {
            <h1>{{ downloadTitle() }}</h1>
            <p class="body">{{ t().onboarding.download.body }}</p>
            <p class="meta">{{ t().onboarding.download.meta }}</p>
            <div class="row">
              <button class="ghost" (click)="step.set('intro')">
                {{ t().onboarding.download.back }}
              </button>
              <button class="primary" (click)="startDownload()">
                {{ t().onboarding.download.start }}
              </button>
            </div>
          }
          @case ('ready') {
            <h1>
              {{ done() ? t().onboarding.ready.titleReady : t().onboarding.ready.titleDownloading }}
            </h1>
            @if (error()) {
              <p class="error">{{ t().onboarding.ready.error }}</p>
              <button class="primary" (click)="startDownload()">
                {{ t().onboarding.ready.retry }}
              </button>
            } @else {
              <div
                class="progress"
                role="progressbar"
                [attr.aria-valuenow]="preload.progress()"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <div class="bar" [style.width.%]="preload.progress()"></div>
              </div>
              <p class="meta">{{ preload.progress() }} %</p>
              @if (done()) {
                <p class="body">{{ t().onboarding.ready.body }}</p>
                <button class="primary" (click)="finish()">
                  {{ t().onboarding.ready.start }}
                </button>
              }
            }
          }
        }
      </div>
    </div>
  `,
  styles: `
    .onboarding {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--aparte-bg);
    }
    .card {
      max-width: 480px;
      width: 100%;
      background: var(--aparte-surface-1);
      border: 1px solid var(--aparte-border);
      border-radius: 18px;
      padding: 40px 36px;
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 14px;
      align-items: center;
    }
    .tag {
      font-family: var(--bp-mono);
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--aparte-text-muted);
      margin: 0;
    }
    h1 {
      font-size: 26px;
      margin: 0;
    }
    .body {
      color: var(--aparte-text-muted);
      margin: 0;
      line-height: 1.6;
    }
    .meta {
      font-size: 12px;
      color: var(--aparte-text-muted);
      margin: 0;
    }
    .bullets {
      list-style: none;
      padding: 0;
      margin: 8px 0;
      display: grid;
      gap: 10px;
      text-align: left;
      width: 100%;
    }
    .bullets li {
      display: grid;
      gap: 2px;
      padding: 10px 14px;
      background: var(--aparte-surface-2);
      border-radius: 10px;
    }
    .bullets span {
      color: var(--aparte-text-muted);
      font-size: 13px;
    }
    .row {
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    button {
      font: inherit;
      border-radius: 10px;
      padding: 10px 22px;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .primary {
      background: var(--aparte-primary);
      color: var(--aparte-on-primary, #fff);
    }
    .primary:hover {
      background: var(--aparte-primary-hover);
    }
    .ghost {
      background: transparent;
      border-color: var(--aparte-border);
      color: var(--aparte-text);
    }
    .progress {
      width: 100%;
      height: 8px;
      border-radius: 4px;
      background: var(--aparte-surface-3);
      overflow: hidden;
    }
    .bar {
      height: 100%;
      background: var(--aparte-primary);
      transition: width 0.3s ease;
    }
    .error {
      color: var(--aparte-error);
      margin: 0;
    }
  `,
})
export class OnboardingComponent {
  protected readonly preload = inject(OnboardingPreloadService);
  private readonly i18n = inject(TranslateService);

  readonly done$ = output<void>();

  protected readonly t = this.i18n.t;
  protected readonly step = signal<StepKind>('intro');

  constructor() {
    void this.loadVisionSize();
  }

  protected readonly done = computed(() => this.preload.state() === 'done');
  protected readonly error = computed(() => this.preload.state() === 'error');

  protected readonly tag = computed(() => {
    const o = this.t().onboarding;
    return { intro: o.intro.tag, download: o.download.tag, ready: o.ready.tag }[this.step()];
  });

  /**
   * Announced total: base + 4 souffleurs + overhead, PLUS the vision tower
   * when it's published (it's part of the model, not an option). Read from
   * the manifest so its size isn't hardcoded.
   */
  private readonly extraBytes = signal(0);

  private async loadVisionSize(): Promise<void> {
    try {
      const manifest = await getSouffleurManifest();
      this.extraBytes.set(manifest.visionSize());
    } catch {
      /* offline: we announce the total without the tower */
    }
  }

  protected readonly downloadTitle = computed(() =>
    this.t().onboarding.download.title.replace(
      '{size}',
      formatSize(TOTAL_DOWNLOAD_BYTES + this.extraBytes()),
    ),
  );

  protected readonly mascotteState = computed<MascotteState>(() => {
    if (this.step() === 'intro') return 'idle';
    if (this.step() === 'download') return 'wake';
    if (this.error()) return 'error';
    if (this.done()) return 'happy';
    const p = this.preload.progress();
    return p < 30 ? 'sleeping' : p < 85 ? 'wake' : 'thinking';
  });

  protected startDownload(): void {
    this.step.set('ready');
    void this.preload.start();
  }

  protected finish(): void {
    localSet(LOCAL_KEYS.ONBOARDING_SEEN, '1');
    this.done$.emit();
  }
}

function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000_000).toFixed(1).replace('.', ',')} Go`;
}
