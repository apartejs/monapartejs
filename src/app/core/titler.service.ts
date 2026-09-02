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
import { Injectable, effect, inject } from '@angular/core';
import { ConversationManagerService } from '@aparte/angular';
import type { AparteConversation } from '@aparte/core';
import { firstUserTextToTitle, withoutLeadingFragment } from './conversation-text';

/** The Titler's shape, so this module does not import the package for a type. */
interface Titler {
  title(message: string, budget?: number): string;
}

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
   * Dynamic import: 77 KB of model has no business in the initial bundle of an app
   * whose first screen is an onboarding.
   */
  private load(): Promise<Titler> {
    this.titler ??= import('@aparte/titler-efigsp').then((m) => m.loadTitler());
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
    } catch {
      // The library's truncated title is already in place: a titler that fails to
      // load leaves a conversation named, just less well. Nothing to report.
    }
  }
}
