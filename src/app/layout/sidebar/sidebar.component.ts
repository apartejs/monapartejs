import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { ConversationManagerService } from '@aparte/angular';
import type { AparteConversation } from '@aparte/core';
import { MascotteComponent } from '../../mascotte';
import { ModelStatusService } from '../../core/model-status.service';
import { TranslateService } from '../../core/i18n/translate.service';

interface ConvGroup {
  label: string;
  items: AparteConversation[];
}

@Component({
  selector: 'bp-sidebar',
  standalone: true,
  imports: [MascotteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="sidebar">
      <header class="brand bp-serif">
        <bp-mascotte [state]="'idle'" [size]="22" />
        <span>{{ t().brand }}</span>
      </header>

      <button class="new-chat" (click)="newChat()">{{ t().sidebar.newChat }}</button>
      <button class="search" (click)="openSearch.emit()">
        <span>{{ t().sidebar.search }}</span>
        <kbd>{{ searchKbd }}</kbd>
      </button>

      <nav class="list">
        @for (group of groups(); track group.label) {
          <p class="group-label">{{ group.label }}</p>
          @for (conv of group.items; track conv.id) {
            <div class="item" [class.active]="conv.id === manager.activeId()">
              <button class="title" (click)="open(conv.id)">{{ conv.title }}</button>
              <span class="actions">
                <button
                  class="icon"
                  [title]="t().sidebar.archive"
                  (click)="archive(conv.id)"
                  aria-label="archiver"
                >
                  ▿
                </button>
                <button
                  class="icon"
                  [title]="t().sidebar.delete"
                  (click)="remove(conv.id)"
                  aria-label="supprimer"
                >
                  ×
                </button>
              </span>
            </div>
          }
        } @empty {
          <p class="empty">{{ t().sidebar.empty }}</p>
        }

        @if (manager.archivedConversations().length) {
          <button class="group-label archived-toggle" (click)="showArchived.set(!showArchived())">
            {{ t().sidebar.archived }} ({{ manager.archivedConversations().length }})
            {{ showArchived() ? '▾' : '▸' }}
          </button>
          @if (showArchived()) {
            @for (conv of manager.archivedConversations(); track conv.id) {
              <div class="item archived">
                <button class="title" (click)="open(conv.id)">{{ conv.title }}</button>
                <span class="actions">
                  <button class="icon" [title]="t().sidebar.unarchive" (click)="unarchive(conv.id)">
                    ▵
                  </button>
                  <button class="icon" [title]="t().sidebar.delete" (click)="remove(conv.id)">
                    ×
                  </button>
                </span>
              </div>
            }
          }
        }
      </nav>

      <footer class="foot">
        <button class="settings" (click)="openSettings.emit()">{{ t().sidebar.settings }}</button>
        <span class="status">
          <span class="dot" [class]="'dot ' + modelStatus.dotClass()"></span>
          {{ statusLabel() }}
        </span>
      </footer>
    </aside>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .sidebar {
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--aparte-surface-1);
      border-right: 1px solid var(--aparte-border);
      overflow: hidden;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 16px;
      font-size: 18px;
      font-weight: 600;
    }
    .new-chat {
      margin: 4px 12px 10px;
      padding: 9px 12px;
      border-radius: 10px;
      border: none;
      background: var(--aparte-primary);
      color: var(--aparte-on-primary, #fff);
      font: inherit;
      cursor: pointer;
    }
    .new-chat:hover {
      background: var(--aparte-primary-hover);
    }
    .search {
      margin: 0 12px 10px;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid var(--aparte-border);
      background: none;
      color: var(--aparte-text-muted);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .search:hover {
      background: var(--aparte-surface-2);
      color: var(--aparte-text);
    }
    .search kbd {
      font-family: var(--bp-mono);
      font-size: 10px;
      border: 1px solid var(--aparte-border);
      border-radius: 5px;
      padding: 1px 6px;
      color: var(--aparte-text-muted);
    }
    .list {
      flex: 1;
      overflow-y: auto;
      padding: 0 8px;
    }
    .group-label {
      font-family: var(--bp-mono);
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--aparte-text-muted);
      margin: 14px 8px 4px;
    }
    .archived-toggle {
      background: none;
      border: none;
      cursor: pointer;
      display: block;
      width: 100%;
      text-align: left;
      padding: 0;
    }
    .item {
      display: flex;
      align-items: center;
      border-radius: 8px;
      padding: 2px 4px;
    }
    .item:hover {
      background: var(--aparte-surface-2);
    }
    .item.active {
      background: var(--aparte-surface-2);
    }
    .item .title {
      flex: 1;
      text-align: left;
      background: none;
      border: none;
      font: inherit;
      color: var(--aparte-text);
      padding: 7px 6px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .item .actions {
      visibility: hidden;
      display: inline-flex;
    }
    .item:hover .actions {
      visibility: visible;
    }
    .icon {
      background: none;
      border: none;
      color: var(--aparte-text-muted);
      cursor: pointer;
      padding: 4px;
      font-size: 13px;
    }
    .icon:hover {
      color: var(--aparte-text);
    }
    .empty {
      color: var(--aparte-text-muted);
      font-size: 13px;
      padding: 8px;
    }
    .foot {
      border-top: 1px solid var(--aparte-border);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .settings {
      background: none;
      border: none;
      font: inherit;
      color: var(--aparte-text);
      cursor: pointer;
      padding: 4px 0;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--aparte-text-muted);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.ok {
      background: var(--aparte-success);
    }
    .dot.busy {
      background: var(--aparte-warning);
    }
    .dot.error {
      background: var(--aparte-error);
    }
    .dot.off {
      background: var(--aparte-text-muted);
    }
  `,
})
export class SidebarComponent {
  protected readonly manager = inject(ConversationManagerService);
  protected readonly modelStatus = inject(ModelStatusService);
  private readonly i18n = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  readonly openSettings = output<void>();
  readonly openSearch = output<void>();

  protected readonly t = this.i18n.t;
  protected readonly showArchived = signal(false);
  protected readonly searchKbd = /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  protected readonly groups = computed<ConvGroup[]>(() => {
    const s = this.t().sidebar;
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const startOfYesterday = startOfToday - 86_400_000;
    const groups: ConvGroup[] = [
      { label: s.today, items: [] },
      { label: s.yesterday, items: [] },
      { label: s.earlier, items: [] },
    ];
    for (const conv of this.manager.activeConversations()) {
      const idx = conv.updatedAt >= startOfToday ? 0 : conv.updatedAt >= startOfYesterday ? 1 : 2;
      groups[idx].items.push(conv);
    }
    return groups.filter((g) => g.items.length > 0);
  });

  protected readonly statusLabel = computed(() => {
    const labels = this.t().modelStatus;
    switch (this.modelStatus.state().status) {
      case 'ready':
        return labels.ready;
      case 'generating':
        return labels.generating;
      case 'downloading':
        return labels.downloading;
      case 'loading':
        return labels.loading;
      case 'error':
        return labels.error;
      case 'not-downloaded':
        return labels.notDownloaded;
      default:
        return labels.unknown;
    }
  });

  protected newChat(): void {
    // After a conversation is created, the URL is rewritten to /chat/:id WITHOUT
    // navigation (replaceState): the router still thinks it's on '/' and
    // navigate('/') becomes a no-op. The deselection event (id: null)
    // resets the thread to zero in all cases — the lib's controller listens
    // for it globally.
    void this.router.navigate(['/']);
    this.location.replaceState('/');
    window.dispatchEvent(new CustomEvent('aparte-select-conversation', { detail: { id: null } }));
  }

  protected open(id: string): void {
    void this.router.navigate(['/chat', id]);
  }

  protected archive(id: string): void {
    void this.manager.archive(id);
    if (this.manager.activeId() === id) void this.router.navigate(['/']);
  }

  protected unarchive(id: string): void {
    void this.manager.unarchive(id);
  }

  protected remove(id: string): void {
    if (!confirm(this.t().sidebar.deleteConfirm)) return;
    void this.manager.delete(id);
    if (this.manager.activeId() === id) void this.router.navigate(['/']);
  }
}
