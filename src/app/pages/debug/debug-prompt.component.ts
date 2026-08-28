/**
 * /debug/prompt — the last exchange that ACTUALLY went out on the thread.
 *
 * Exists because one question keeps coming back and can only be answered
 * by looking: "is the List of tools block in the prompt?". Without this
 * we guess, and guess wrong — the model denied knowing how to read documents
 * while sp-chat's body says nothing about it, and the two possible causes
 * (learned behavior VS tools missing from the prompt) can ONLY be told apart here.
 *
 * No condition, no flag: the provider keeps the last two strings
 * in memory. Nothing is persisted, nothing leaves the device.
 */
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { SOUFFLEUR_TOOL_NAMES, getLastWire } from '../../souffleurs';

@Component({
  selector: 'bp-debug-prompt',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <h1>Dernier échange sur le fil</h1>
      <p class="hint">
        Envoie un message dans le chat, puis reviens ici. Rien n'est persisté.
        <button type="button" (click)="refresh()">Rafraîchir</button>
      </p>

      @if (wire(); as w) {
        <section>
          <h2>Contrôles</h2>
          <ul class="checks">
            @for (c of checks(); track c.label) {
              <li [class.ko]="!c.ok">
                <span class="mark">{{ c.ok ? 'OK ' : 'KO ' }}</span
                >{{ c.label }}
                @if (c.detail) {
                  <span class="detail">— {{ c.detail }}</span>
                }
              </li>
            }
          </ul>
        </section>

        <section>
          <h2>Prompt envoyé ({{ w.prompt.length }} caractères)</h2>
          <pre>{{ w.prompt }}</pre>
        </section>

        <section>
          <h2>Sortie brute du modèle</h2>
          <pre>{{ w.raw || '(vide — génération en cours ou annulée)' }}</pre>
        </section>
      } @else {
        <p class="empty">Aucun échange encore. Envoie un message d'abord.</p>
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      background: var(--aparte-bg);
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 24px 20px 64px;
      color: var(--aparte-text);
    }
    h1 {
      font-size: 20px;
      margin: 0 0 4px;
    }
    h2 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--aparte-text-muted);
      margin: 24px 0 8px;
    }
    .hint,
    .empty {
      color: var(--aparte-text-muted);
      font-size: 13px;
    }
    button {
      font: inherit;
      font-size: 12px;
      margin-left: 8px;
      padding: 3px 10px;
      border-radius: 8px;
      border: 1px solid var(--aparte-border);
      background: var(--aparte-surface-1);
      color: inherit;
      cursor: pointer;
    }
    pre {
      margin: 0;
      padding: 12px 14px;
      border: 1px solid var(--aparte-border);
      border-radius: 10px;
      background: var(--aparte-surface-1);
      font-family: var(--bp-mono, monospace);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 460px;
      overflow: auto;
    }
    .checks {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 4px;
      font-size: 13px;
    }
    .checks li {
      font-family: var(--bp-mono, monospace);
    }
    .checks li.ko {
      color: var(--aparte-error);
    }
    .mark {
      display: inline-block;
      width: 34px;
    }
    .detail {
      color: var(--aparte-text-muted);
    }
  `,
})
export class DebugPromptComponent {
  private readonly tick = signal(0);

  protected readonly wire = computed(() => {
    this.tick();
    return getLastWire();
  });

  /**
   * The checks that matter, in the order they break in practice.
   * `List of tools` missing = the client's `function_calling` gate didn't pass
   * the tools through, and the model is then RIGHT to say it can't do anything.
   */
  protected readonly checks = computed(() => {
    const w = this.wire();
    if (!w) return [];
    const prompt = w.prompt;
    const listed = SOUFFLEUR_TOOL_NAMES.filter((n) => prompt.includes(`"${n}"`));
    return [
      {
        label: 'bloc « List of tools »',
        ok: prompt.includes('List of tools:'),
        detail: listed.length ? `${listed.length} outils : ${listed.join(', ')}` : 'AUCUN outil',
      },
      {
        label: 'bloc « Files available »',
        ok: prompt.includes('Files available:'),
        detail: prompt.includes('Files available:')
          ? 'présent'
          : 'absent (normal si rien n’est joint)',
      },
      {
        label: 'BOS unique en tête',
        ok:
          prompt.startsWith('<|startoftext|>') &&
          !prompt.startsWith('<|startoftext|><|startoftext|>'),
        detail: prompt.slice(0, 32),
      },
      {
        label: 'tour assistant ouvert en fin de prompt',
        ok: prompt.trimEnd().endsWith('<|im_start|>assistant'),
        detail: JSON.stringify(prompt.slice(-40)),
      },
      {
        label: 'appel d’outil dans la sortie',
        ok: w.raw.includes('<|tool_call_start|>'),
        detail: w.raw.includes('<|tool_call_start|>') ? 'oui' : 'réponse texte seule',
      },
    ];
  });

  protected refresh(): void {
    this.tick.update((n) => n + 1);
  }
}
