/**
 * SEUL point de contact avec la lib apartéJS : tout le câblage AparteConfig /
 * plugins / client / conversation manager vit ici. Les autres modules ne
 * touchent jamais AparteConfig directement.
 */
import {
  inject,
  isDevMode,
  provideAppInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { ConversationManagerService, provideAparte } from '@aparte/angular';
import { AparteConfig, DirectTransport } from '@aparte/core';
import { fr } from '@aparte/locale-fr';
import { setupAskQuestion } from '@aparte/plugin-ask-question';
import { setupMarkedProvider } from '@aparte/plugin-marked';
import { setupShikiProvider } from '@aparte/plugin-shiki';
import { setupStreamingMarkdownProvider } from '@aparte/plugin-streaming-markdown';
import '@aparte/plugin-model-selector';
import { registerMascotteRenderers } from '../mascotte';
import {
  CALLER_MODEL_ID,
  SouffleursProvider,
  souffleurAskQuestionHandler,
  souffleurAskQuestionTool,
} from '../souffleurs';
import { DexieConversationAdapter } from '../storage/conversation-adapter';
import { LOCAL_KEYS, SettingsService, localGet } from '../storage/settings.service';
import { LinkGuardService } from './link-guard.service';
import { RichRenderService } from './rich-render.service';

/** Adapter partagé (conversations + settings + export/import). */
export const conversationAdapter = new DexieConversationAdapter();

export function currentLocale(): 'fr' | 'en' {
  const stored = localGet(LOCAL_KEYS.LOCALE);
  if (stored === 'fr' || stored === 'en') return stored;
  return (navigator.language || 'fr').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function provideBonaparte(): EnvironmentProviders[] {
  return [
    provideAparte({
      providers: [SouffleursProvider],
      modelConfig: { defaultProvider: 'souffleurs', defaultModel: CALLER_MODEL_ID },
      // Locale lib : fr explicite, en = défaut embarqué.
      ...(currentLocale() === 'fr' ? { locale: fr } : {}),
      clientOptions: {
        // Borne de la boucle agentique du contrat souffleurs (MAX_AGENTIC_ITERATIONS).
        maxTurns: 6,
        // Les fichiers joints passent par le bloc « Files available » du prompt
        // système (J3), jamais inlinés en base64 dans les messages.
        rawFileInject: 'none',
      },
    }),
    provideAppInitializer(async () => {
      AparteConfig.setTransport(new DirectTransport({ byok: true }));

      setupMarkedProvider();
      setupStreamingMarkdownProvider();
      // Shiki charge ses langues à la demande — ne bloque pas le boot.
      void setupShikiProvider();

      setupAskQuestion();
      // Par-dessus le handler du plugin : shim contrat souffleurs
      // (multi_select→multiple, options string[]→{title}[]).
      AparteConfig.registerTool(souffleurAskQuestionTool, souffleurAskQuestionHandler);

      registerMascotteRenderers();
      inject(LinkGuardService).install();
      inject(RichRenderService).install();

      const manager = inject(ConversationManagerService);
      const settings = inject(SettingsService);
      await Promise.all([
        manager.init(conversationAdapter),
        settings.init(conversationAdapter),
      ]);
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // Ne concurrence jamais le téléchargement du modèle au premier lancement.
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ];
}
