/**
 * Garde-liens (iso aimi) : tout lien http(s) externe cliqué dans une réponse
 * générée passe par une confirmation avant ouverture (noopener, noreferrer).
 * Dialog en DOM pur (même approche que les renderers mascotte).
 */
import { Injectable, inject } from '@angular/core';
import { TranslateService } from './i18n/translate.service';

@Injectable({ providedIn: 'root' })
export class LinkGuardService {
  private readonly i18n = inject(TranslateService);
  private installed = false;

  install(): void {
    if (this.installed) return;
    this.installed = true;
    document.addEventListener(
      'click',
      (event) => {
        const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
        if (!anchor) return;
        // Uniquement les liens à l'intérieur du chat (contenu généré).
        if (!anchor.closest('aparte-chat, [data-aparte-chat]')) return;
        const href = anchor.getAttribute('href') ?? '';
        let url: URL;
        try {
          url = new URL(href, location.href);
        } catch {
          return;
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
        if (url.origin === location.origin) return;
        event.preventDefault();
        event.stopPropagation();
        this.confirmOpen(url.href);
      },
      true,
    );
  }

  private confirmOpen(href: string): void {
    const t = this.i18n.t();
    const backdrop = document.createElement('div');
    backdrop.className = 'bp-linkguard-backdrop';
    const card = document.createElement('div');
    card.className = 'bp-linkguard-card';

    const title = document.createElement('h3');
    title.textContent = t.linkGuard.title;
    const body = document.createElement('p');
    body.textContent = t.linkGuard.body;
    const urlEl = document.createElement('code');
    urlEl.textContent = href;
    const row = document.createElement('div');
    row.className = 'bp-linkguard-row';
    const cancel = document.createElement('button');
    cancel.className = 'bp-linkguard-cancel';
    cancel.textContent = t.common.cancel;
    const open = document.createElement('button');
    open.className = 'bp-linkguard-open';
    open.textContent = t.linkGuard.open;

    const closeDialog = () => backdrop.remove();
    cancel.addEventListener('click', closeDialog);
    backdrop.addEventListener('click', (e) => e.target === backdrop && closeDialog());
    open.addEventListener('click', () => {
      window.open(href, '_blank', 'noopener,noreferrer');
      closeDialog();
    });

    row.append(cancel, open);
    card.append(title, body, urlEl, row);
    backdrop.append(card);
    this.ensureStyles();
    document.body.append(backdrop);
    open.focus();
  }

  private ensureStyles(): void {
    if (document.getElementById('bp-linkguard-styles')) return;
    const style = document.createElement('style');
    style.id = 'bp-linkguard-styles';
    style.textContent = `
.bp-linkguard-backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / 45%); z-index: 60; display: grid; place-items: center; }
.bp-linkguard-card { background: var(--aparte-surface-1); border: 1px solid var(--aparte-border); border-radius: 14px; padding: 22px 24px; width: min(420px, 92vw); display: grid; gap: 10px; }
.bp-linkguard-card h3 { margin: 0; font-family: var(--bp-serif, serif); font-size: 18px; }
.bp-linkguard-card p { margin: 0; color: var(--aparte-text-muted); font-size: 13.5px; line-height: 1.5; }
.bp-linkguard-card code { display: block; background: var(--aparte-surface-2); border-radius: 8px; padding: 8px 10px; font-size: 12.5px; word-break: break-all; }
.bp-linkguard-row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
.bp-linkguard-row button { font: inherit; font-size: 13px; border-radius: 9px; padding: 8px 16px; cursor: pointer; }
.bp-linkguard-cancel { background: none; border: 1px solid var(--aparte-border); color: var(--aparte-text); }
.bp-linkguard-open { background: var(--aparte-primary); border: none; color: var(--aparte-on-primary, #fff); }
`;
    document.head.append(style);
  }
}
