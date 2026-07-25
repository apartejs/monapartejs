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
  artifactCardRenderer,
  computeHandler,
  computeTool,
  createWidgetHandler,
  createWidgetTool,
  fileRegistry,
  invisibleRenderer,
  readFileHandler,
  readFileTool,
  setArtifactLoader,
  setArtifactSink,
  setReminderHandler,
  setReminderTool,
  souffleurAskQuestionHandler,
  souffleurAskQuestionTool,
  transformFileHandler,
  transformFileTool,
  widgetRenderer,
  writeFileHandler,
  writeFileTool,
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
        // système, jamais inlinés en base64 dans les messages.
        rawFileInject: 'none',
        requestInterceptor: (request) => ({
          ...request,
          _meta: { ...request._meta, souffleurFiles: fileRegistry.listForWire() },
        }),
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

      // Les 9 outils du contrat (search_knowledge/remember = leurres RAG, non
      // enregistrés : ils restent hors de la liste d'activation).
      AparteConfig.registerTool(readFileTool, readFileHandler);
      AparteConfig.registerTool(writeFileTool, writeFileHandler);
      AparteConfig.registerTool(computeTool, computeHandler);
      AparteConfig.registerTool(createWidgetTool, createWidgetHandler);
      AparteConfig.registerTool(transformFileTool, transformFileHandler);
      AparteConfig.registerTool(setReminderTool, setReminderHandler);

      AparteConfig.registerToolRenderer('write_file', artifactCardRenderer);
      AparteConfig.registerToolRenderer('transform_file', artifactCardRenderer);
      AparteConfig.registerToolRenderer('create_widget', widgetRenderer);
      AparteConfig.registerToolRenderer('compute', invisibleRenderer);

      // Persistance des artefacts produits (blob + aperçu) — indispensable pour
      // réhydrater les cartes après un reload (la Map mémoire est vide).
      setArtifactSink((toolCallId, artifact, fileId) => {
        void conversationAdapter.db.artifacts.put({
          id: fileId,
          convId: '',
          msgId: toolCallId,
          name: artifact.filename,
          mimeType: artifact.mime,
          artifactType: artifact.kind,
          content: artifact.preview,
          blob: artifact.blob,
          updatedAt: Date.now(),
        });
      });
      setArtifactLoader(async (toolCallId) => {
        // msgId non indexé : simple scan (table artifacts petite).
        const row = await conversationAdapter.db.artifacts
          .filter((r) => r.msgId === toolCallId)
          .first();
        if (!row?.blob) return null;
        return {
          kind: row.artifactType,
          filename: row.name,
          mime: row.mimeType,
          blob: row.blob,
          preview: row.content ?? '',
        };
      });

      // Capture des pièces jointes AU MOMENT de l'envoi : le détail
      // d'aparte-send ne les porte pas, mais le composer source les expose.
      window.addEventListener(
        'aparte-send',
        (event) => {
          const composer = (event.target as HTMLElement | null)?.closest?.(
            'aparte-composer',
          ) as (HTMLElement & { attachments?: File[] }) | null;
          for (const file of composer?.attachments ?? []) {
            fileRegistry.register(file);
          }
        },
        true,
      );

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
