import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { ConversationManagerService } from '@aparte/angular';
import { TranslateService } from '../../core/i18n/translate.service';

interface SearchHit {
  convId: string;
  title: string;
  /** [avant, correspondance, après] pour le surlignage sans innerHTML. */
  snippet: [string, string, string] | null;
}

/** Palette ⌘K — recherche client-side sur titres + contenus (iso aimi). */
@Component({
  selector: 'bp-search-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <div class="palette" role="dialog" aria-label="recherche">
      <input
        #input
        type="text"
        [placeholder]="t().search.placeholder"
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="results">
        @for (hit of hits(); track hit.convId; let i = $index) {
          <button
            class="hit"
            [class.active]="i === activeIndex()"
            (click)="open(hit.convId)"
            (mouseenter)="activeIndex.set(i)"
          >
            <span class="title">{{ hit.title }}</span>
            @if (hit.snippet; as s) {
              <span class="snippet"
                >…{{ s[0] }}<mark>{{ s[1] }}</mark
                >{{ s[2] }}…</span
              >
            }
          </button>
        } @empty {
          @if (query().length > 1) {
            <p class="empty">{{ t().search.noResults }}</p>
          }
        }
      </div>
      <p class="hint">{{ t().search.hint }}</p>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgb(0 0 0 / 40%);
      z-index: 44;
      animation: bp-fade 0.15s ease;
    }
    @keyframes bp-fade {
      from {
        opacity: 0;
      }
    }
    .palette {
      position: fixed;
      top: 14vh;
      left: 50%;
      transform: translateX(-50%);
      width: min(560px, 92vw);
      z-index: 45;
      background: var(--aparte-surface-1);
      border: 1px solid var(--aparte-border);
      border-radius: 14px;
      box-shadow: 0 24px 64px -16px rgb(0 0 0 / 40%);
      overflow: hidden;
      animation: bp-pop 0.18s ease;
      display: flex;
      flex-direction: column;
    }
    @keyframes bp-pop {
      from {
        opacity: 0;
        transform: translate(-50%, -6px);
      }
    }
    input {
      font: inherit;
      font-size: 15px;
      border: none;
      outline: none;
      background: none;
      color: var(--aparte-text);
      padding: 15px 18px;
      border-bottom: 1px solid var(--aparte-border);
    }
    .results {
      max-height: 45vh;
      overflow-y: auto;
      padding: 6px;
    }
    .hit {
      display: grid;
      gap: 2px;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      font: inherit;
      color: var(--aparte-text);
      padding: 9px 12px;
      border-radius: 9px;
      cursor: pointer;
    }
    .hit.active {
      background: var(--aparte-surface-2);
    }
    .title {
      font-weight: 500;
      font-size: 14px;
    }
    .snippet {
      font-size: 12.5px;
      color: var(--aparte-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    mark {
      background: color-mix(in srgb, var(--aparte-primary) 30%, transparent);
      color: inherit;
      border-radius: 3px;
      padding: 0 1px;
    }
    .empty {
      color: var(--aparte-text-muted);
      font-size: 13px;
      text-align: center;
      padding: 16px;
      margin: 0;
    }
    .hint {
      margin: 0;
      padding: 8px 14px;
      font-family: var(--bp-mono);
      font-size: 10.5px;
      color: var(--aparte-text-muted);
      border-top: 1px solid var(--aparte-border);
    }
  `,
})
export class SearchPaletteComponent implements AfterViewInit {
  private readonly manager = inject(ConversationManagerService);
  private readonly router = inject(Router);
  private readonly i18n = inject(TranslateService);

  readonly close = output<void>();

  protected readonly t = this.i18n.t;
  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly hits = computed<SearchHit[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (q.length < 2) return [];
    const out: SearchHit[] = [];
    for (const conv of this.manager.conversations()) {
      let snippet: SearchHit['snippet'] = null;
      let matched = conv.title.toLowerCase().includes(q);
      for (const message of conv.messages) {
        const content = message.content ?? '';
        const idx = content.toLowerCase().indexOf(q);
        if (idx !== -1) {
          matched = true;
          snippet = [
            content.slice(Math.max(0, idx - 32), idx),
            content.slice(idx, idx + q.length),
            content.slice(idx + q.length, idx + q.length + 48),
          ];
          break;
        }
      }
      if (matched) out.push({ convId: conv.id, title: conv.title, snippet });
      if (out.length >= 12) break;
    }
    return out;
  });

  ngAfterViewInit(): void {
    this.input().nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const hits = this.hits();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.set(Math.min(this.activeIndex() + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
    } else if (event.key === 'Enter' && hits[this.activeIndex()]) {
      this.open(hits[this.activeIndex()].convId);
    }
  }

  protected open(convId: string): void {
    void this.router.navigate(['/chat', convId]);
    this.close.emit();
  }

  @HostListener('window:keydown.escape')
  protected onEscape(): void {
    this.close.emit();
  }
}
