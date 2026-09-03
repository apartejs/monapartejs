/**
 * Conversation titles, from a 77 KB model that runs on the person's machine.
 *
 * The library titles a conversation from its first user message by truncating it
 * (`_autoTitle` in the conversation manager). `@aparte/titler-efigsp` reads the same
 * message and returns the three to six words that carry it — six languages, ours
 * among them, 6 to 7 ms on a CPU, no network and no Hugging Face at runtime.
 *
 * Two properties earn it a place in a local-first product. It is EXTRACTIVE: the
 * output can only be words copied from the message, so a message that contains
 * instructions cannot make it write something else — the title is the one string we
 * render from arbitrary user text without a model that could be steered. And it never
 * leaves the device, like everything else here.
 *
 * We title ONCE, when a conversation first receives a user message, and never again:
 * a later pass would overwrite a rename the person made by hand, and there is no flag
 * on a conversation that tells an automatic title from a chosen one.
 */
import { Injectable, effect, inject, isDevMode } from '@angular/core';
import { ConversationManagerService } from '@aparte/angular';
import type { AparteConversation } from '@aparte/core';
import { firstUserTextToTitle } from './conversation-text';
// Type-only, so it is erased at compile time and the package still arrives through
// the dynamic import below rather than in the initial bundle.
import type { Titler } from '@aparte/titler-efigsp';

/**
 * The model file copied by angular.json. Named here rather than read from the
 * package's `modelUrl`, which cannot be imported in the browser (see `load()`). The
 * asset glob copies `model/*.bin`, so a version that renames its model would 404 —
 * which `load()` reports rather than swallows, so it is a visible failure, not a
 * conversation quietly titled by truncation.
 */
const MODEL_FILE = 'titler-v1-efigsp-int3.bin';

@Injectable({ providedIn: 'root' })
export class TitlerService {
  private readonly manager = inject(ConversationManagerService);
  /** Loaded on first use, then kept: the model file is fetched once. */
  private titler: Promise<Titler> | null = null;
  /** Conversations titled in this session — the guard against a second pass. */
  private readonly titled = new Set<string>();

  install(): void {
    effect(() => {
      for (const conversation of this.manager.conversations()) {
        void this.maybeTitle(conversation);
      }
    });
  }

  /**
   * The model file is served by us, and handed to the package.
   *
   * A bundler rewrites neither `import.meta.url` nor the package-relative path the
   * default model URL is built from, so `loadTitler()` with no argument resolves next
   * to the bundle and 404s in a browser. Since 1.0.4 it takes the model instead — a
   * URL, a string, an ArrayBuffer or a Response — so the file we copy to
   * `assets/titler/` (scripts/copy-titler-model.mjs) is simply passed in.
   *
   * One package, at last: 1.0.4 moved the file-system read behind the `node` export
   * condition and made the portable entry the default, so importing this no longer
   * drags `node:url` into a browser build. Reported as
   * apartejs/aparte-titler-model#2 and fixed there.
   *
   * Dynamic import: 77 KB of model has no business in the initial bundle of an app
   * whose first screen is an onboarding.
   */
  private load(): Promise<Titler> {
    this.titler ??= import('@aparte/titler-efigsp').then((m) =>
      m.loadTitler(`assets/titler/${MODEL_FILE}`),
    );
    return this.titler;
  }

  private async maybeTitle(conversation: AparteConversation): Promise<void> {
    if (this.titled.has(conversation.id)) return;
    const text = firstUserTextToTitle(conversation);
    if (!text) return;
    // Claimed before the await: the effect re-runs on every conversation change,
    // and two runs could otherwise both pass the guard while the model loads.
    this.titled.add(conversation.id);
    try {
      const title = (await this.load()).title(text).trim();
      if (title) await this.manager.updateTitle(conversation.id, title);
    } catch (error) {
      // The library's truncated title is already in place, so a conversation stays
      // named — just less well. Reported in dev all the same: the failure mode here is
      // a 404 on a renamed model file, and silence is how that survives a release.
      if (isDevMode()) console.warn('[titler] no title generated', error);
    }
  }
}
