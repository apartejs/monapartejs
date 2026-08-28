/**
 * Rendus riches lazy (iso aimi) : KaTeX ($…$ / $$…$$) et Mermaid (blocs de
 * code mermaid) sur les bulles TERMINÉES. Les libs (~250 Ko / ~1,5 Mo) ne sont
 * importées qu'à la première occurrence. Best-effort : un échec de rendu
 * laisse le texte/code d'origine.
 */
import { Injectable } from '@angular/core';

const KATEX_RE = /\$\$([^$]+)\$\$|(?<![\\$])\$([^$\n]+)\$(?!\$)/g;

@Injectable({ providedIn: 'root' })
export class RichRenderService {
  private observer: MutationObserver | null = null;
  private debounce = 0;

  install(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(() => {
      clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => void this.processAll(), 350);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  private async processAll(): Promise<void> {
    const root = document.querySelector('aparte-chat, [data-aparte-chat]');
    if (!root) return;
    // Jamais pendant le stream : on attend les bulles stabilisées.
    if (root.querySelector('[data-streaming="true"]')) return;
    await this.renderMermaid(root);
    await this.renderKatex(root);
  }

  private async renderMermaid(root: Element): Promise<void> {
    const blocks = [
      ...root.querySelectorAll<HTMLElement>(
        'code.language-mermaid:not([data-bp-mermaid]), [data-language="mermaid"]:not([data-bp-mermaid]) code, pre[data-lang="mermaid"]:not([data-bp-mermaid]) code',
      ),
    ];
    if (!blocks.length) return;
    try {
      const { default: mermaid } = await import('mermaid');
      mermaid.initialize({
        startOnLoad: false,
        theme:
          document.documentElement.getAttribute('data-aparte-theme') === 'dark'
            ? 'dark'
            : 'neutral',
      });
      for (const [i, code] of blocks.entries()) {
        const host = code.closest('pre') ?? code;
        host.setAttribute('data-bp-mermaid', '1');
        try {
          const { svg } = await mermaid.render(
            `bp-mermaid-${Date.now()}-${i}`,
            code.textContent ?? '',
          );
          const wrap = document.createElement('div');
          wrap.className = 'bp-mermaid';
          wrap.innerHTML = svg; // sortie mermaid (générée localement), pas du contenu utilisateur brut
          host.replaceWith(wrap);
        } catch {
          /* diagramme invalide : on garde le code source affiché */
        }
      }
    } catch {
      /* import mermaid indisponible */
    }
  }

  private async renderKatex(root: Element): Promise<void> {
    const candidates = [
      ...root.querySelectorAll<HTMLElement>('.aparte-prose p, .aparte-prose li, p'),
    ].filter((el) => !el.dataset['bpKatex'] && KATEX_RE.test(el.textContent ?? ''));
    KATEX_RE.lastIndex = 0;
    if (!candidates.length) return;
    try {
      // Le CSS KaTeX est chargé globalement via angular.json (fontes incluses).
      const katex = (await import('katex')).default;
      for (const el of candidates) {
        el.dataset['bpKatex'] = '1';
        this.renderKatexInTextNodes(el, katex);
      }
    } catch {
      /* import katex indisponible */
    }
  }

  private renderKatexInTextNodes(
    el: HTMLElement,
    katex: { renderToString(tex: string, opts?: object): string },
  ): void {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? '';
      KATEX_RE.lastIndex = 0;
      if (!KATEX_RE.test(text)) continue;
      KATEX_RE.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let last = 0;
      for (const match of text.matchAll(KATEX_RE)) {
        const [full, display, inline] = match;
        frag.append(text.slice(last, match.index));
        const span = document.createElement('span');
        try {
          span.innerHTML = katex.renderToString(display ?? inline, {
            displayMode: display !== undefined,
            throwOnError: true,
          });
          frag.append(span);
        } catch {
          frag.append(full);
        }
        last = match.index + full.length;
      }
      frag.append(text.slice(last));
      textNode.replaceWith(frag);
    }
  }
}
