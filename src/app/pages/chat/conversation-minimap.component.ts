import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';

interface MinimapDot {
  top: number;
  height: number;
  targetTop: number;
}

/**
 * Conversation minimap (iso aimi): rail of dots, one per bubble,
 * height ∝ message height, scroll-spy, click to navigate. Purely
 * decorative: observes the chat DOM without touching state. Hidden <1100px.
 */
@Component({
  selector: 'bp-conversation-minimap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="rail bp-decorative" aria-hidden="true">
      @for (dot of dots(); track $index) {
        <button
          class="dot"
          [class.active]="$index === activeIndex()"
          [style.height.px]="dot.height"
          (click)="scrollTo(dot)"
          tabindex="-1"
        ></button>
      }
    </nav>
  `,
  styles: `
    :host {
      display: none;
      position: absolute;
      right: -34px;
      top: 60px;
      bottom: 120px;
      width: 20px;
      z-index: 5;
    }
    @media (min-width: 1100px) and (pointer: fine) {
      :host {
        display: block;
      }
    }
    .rail {
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: center;
      max-height: 100%;
      overflow: hidden;
    }
    .dot {
      width: 4px;
      min-height: 5px;
      border: none;
      border-radius: 3px;
      background: var(--aparte-border);
      cursor: pointer;
      padding: 0;
      transition:
        background 0.15s ease,
        width 0.15s ease;
    }
    .dot:hover {
      background: var(--aparte-text-muted);
      width: 7px;
    }
    .dot.active {
      background: var(--aparte-primary);
      width: 7px;
    }
  `,
})
export class ConversationMinimapComponent implements AfterViewInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly dots = signal<MinimapDot[]>([]);
  protected readonly activeIndex = signal(-1);

  private scroller: HTMLElement | null = null;
  private rebuildTimer = 0;

  ngAfterViewInit(): void {
    const chat = this.host.nativeElement.parentElement?.querySelector(
      'aparte-chat, [data-aparte-chat]',
    );
    if (!chat) return;

    const mutations = new MutationObserver(() => this.scheduleRebuild());
    mutations.observe(chat, { childList: true, subtree: true });
    const resize = new ResizeObserver(() => this.scheduleRebuild());
    resize.observe(chat);

    const onScroll = () => this.updateActive();
    // The scrolling container appears after the web component's first render.
    const attach = () => {
      const scroller = chat.querySelector<HTMLElement>('.aparte-viewport-container');
      if (scroller && scroller !== this.scroller) {
        this.scroller?.removeEventListener('scroll', onScroll);
        this.scroller = scroller;
        scroller.addEventListener('scroll', onScroll, { passive: true });
      }
    };
    attach();
    const attachInterval = window.setInterval(attach, 1500);

    this.destroyRef.onDestroy(() => {
      mutations.disconnect();
      resize.disconnect();
      clearInterval(attachInterval);
      clearTimeout(this.rebuildTimer);
      this.scroller?.removeEventListener('scroll', onScroll);
    });
    this.scheduleRebuild();
  }

  private scheduleRebuild(): void {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuild(), 250);
  }

  private rebuild(): void {
    if (!this.scroller) return;
    const bubbles = [...this.scroller.querySelectorAll<HTMLElement>('aparte-chat-bubble')];
    const railHeight = this.host.nativeElement.clientHeight || 400;
    const totalContent = this.scroller.scrollHeight || 1;
    const dots = bubbles.map((bubble) => ({
      top: bubble.offsetTop,
      height: Math.max(5, Math.min(28, (bubble.offsetHeight / totalContent) * railHeight)),
      targetTop: bubble.offsetTop,
    }));
    this.dots.set(dots.length > 1 ? dots : []);
    this.updateActive();
  }

  private updateActive(): void {
    if (!this.scroller) return;
    const middle = this.scroller.scrollTop + this.scroller.clientHeight / 2;
    const dots = this.dots();
    let active = -1;
    for (let i = 0; i < dots.length; i++) {
      if (dots[i].top <= middle) active = i;
    }
    this.activeIndex.set(active);
  }

  protected scrollTo(dot: MinimapDot): void {
    this.scroller?.scrollTo({ top: dot.targetTop - 40, behavior: 'smooth' });
  }
}
