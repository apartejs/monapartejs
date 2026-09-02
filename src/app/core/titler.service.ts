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
import { firstUserTextToTitle, withoutLeadingFragment } from './conversation-text';
// Type-only, so it is erased at compile time and the package still arrives through
// the dynamic import below rather than in the initial bundle.
import type { Titler } from '@aparte/titler';

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
   * The model file is served by us, not resolved by the package.
   *
   * `loadTitler()` of `@aparte/titler-efigsp` finds its `.bin` with
   * `new URL('../model/…', import.meta.url)`. Vite pre-bundles the package into
   * `.angular/cache/…/vite/deps/`, `import.meta.url` then points there, and the
   * `model/` directory is not carried over — a 404 on every title, in dev and in a
   * production build alike. The README names this case and the way out: serve the
   * file yourself. So the `.bin` is copied to `assets/titler/` (angular.json, as the
   * pdf.js worker already is) and handed to the runtime as a buffer.
   *
   * The name comes from the package's own `modelUrl` rather than a literal, so a
   * future version that renames or requantises its model keeps working: the asset
   * glob copies whatever `model/*.bin` holds, and this reads the same name.
   *
   * Dynamic import: 77 KB of model has no business in the initial bundle of an app
   * whose first screen is an onboarding.
   */
  private load(): Promise<Titler> {
    this.titler ??= (async () => {
      // From the RUNTIME package, never from `@aparte/titler-efigsp`.
      //
      // The bundled package re-exports the same `Titler`, and reaching for it there
      // costs one dependency less — which is why this code did exactly that, and why
      // the production build then failed. Its `readModelBytes()` has a Node branch
      // (`await import("node:url")`) behind a `process.versions.node` check; the check
      // is a runtime one, esbuild resolves imports statically, and it refuses
      // `node:url` for a browser target. `ng serve` tolerated it, `ng build` did not.
      //
      // `@aparte/titler-efigsp` stays in package.json all the same: angular.json copies
      // its `model/*.bin`. We depend on its FILE, not on its code.
      const { Titler } = await import('@aparte/titler');
      const response = await fetch(`assets/titler/${MODEL_FILE}`);
      if (!response.ok) throw new Error(`titler model ${MODEL_FILE}: HTTP ${response.status}`);
      return new Titler(await response.arrayBuffer());
    })();
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
      const title = withoutLeadingFragment((await this.load()).title(text));
      if (title) await this.manager.updateTitle(conversation.id, title);
    } catch (error) {
      // The library's truncated title is already in place, so a conversation stays
      // named — just less well. Reported in dev all the same: the failure mode here is
      // a 404 on a renamed model file, and silence is how that survives a release.
      if (isDevMode()) console.warn('[titler] no title generated', error);
    }
  }
}
