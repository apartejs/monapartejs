/**
 * Le câblage de la lib apartéJS : transport, plugins, outils, client et
 * conversation manager. Depuis aparté 0.8 la config n'est plus une classe à
 * statiques — `AparteConfig` est le TYPE, `aparteGlobalConfig` l'instance de la
 * page, celle où écrit aussi `provideAparte`.
 *
 * L'enregistrement passe par ici, mais trois modules touchent l'instance de leur
 * côté parce qu'ils POSENT un rendu et non une configuration : `mascotte/`
 * (status + erreur), `souffleurs/tools/tool-renderers` (coloration live) et
 * `core/i18n/translate.service` (bascule de locale).
 */
import { inject, isDevMode, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { ConversationManagerService, provideAparte } from '@aparte/angular';
import { AparteDirectTransport, aparteGlobalConfig, registerSegmentRenderer } from '@aparte/core';
import { fr } from '@aparte/locale-fr';
import { buildReceipt, questionReceiptRenderer } from '@aparte/plugin-ask-user';
import { setupMarkedProvider } from '@aparte/plugin-marked';
import { setupShikiProvider } from '@aparte/plugin-shiki';
import { setupStreamingMarkdownProvider } from '@aparte/plugin-streaming-markdown';
import { registerMascotteRenderers } from '../mascotte';
import {
  CALLER_MODEL_ID,
  SouffleursProvider,
  artifactCardRenderer,
  computeHandler,
  computeTool,
  createWidgetHandler,
  createWidgetTool,
  extType,
  fileRegistry,
  installToolRendererStyles,
  invisibleRenderer,
  readFileHandler,
  readFileTool,
  readFileRenderer,
  setArtifactLoader,
  setArtifactSink,
  setConversationResolver,
  setFileStore,
  setSouffleurDebug,
  setReminderHandler,
  setReminderTool,
  SOUFFLEUR_ASK_QUESTION_TOOL_NAME,
  askQuestionReceiptText,
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

export function provideMonaparte(): EnvironmentProviders[] {
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
      // En dev, les traces du fil (prompt wire, sortie brute, appels parsés)
      // sont actives d'office : c'est le mode où on débugue, on ne doit pas
      // avoir à penser à un flag. `bp.debug` reste un override explicite.
      setSouffleurDebug(isDevMode());

      aparteGlobalConfig.setTransport(new AparteDirectTransport({ byok: true }));
      // Depuis aparté 0.5, TOUTES les actions sauf `copy` sont désactivées par
      // défaut : la lib ne rend que ce que quelqu'un honore (« a button nobody
      // answers is a lie told to the user »). On active donc ce qu'on traite :
      //  - retry/edit : pris en charge par AparteClient, nécessaires aux branches ;
      //  - info : le bouton « i » émet `aparte-message-info`, écouté par
      //    ChatPageComponent qui ouvre le popover de stats. Le popover et son
      //    écouteur existaient déjà — seule l'activation manquait, donc le
      //    bouton avait disparu au passage en 0.5.
      // Rappel lib : `info` ne s'affiche que si le message porte un `usage`.
      aparteGlobalConfig.setBubbleActions({ retry: true, edit: true, info: true });

      setupMarkedProvider();
      setupStreamingMarkdownProvider();
      // Shiki charge ses langues à la demande — ne bloque pas le boot.
      void setupShikiProvider();

      // Pas de `setupAskUser()` : il enregistrerait l'outil sous le nom du
      // plugin (`ask_user`), que le modèle n'émet jamais, et le renderer de
      // reçu sous cette même clé. On repose donc ses trois gestes à la main,
      // sur le nom du contrat. Le shim (multi_select→multiple, options
      // string[]→{title}[]) est dans l'adaptateur.
      aparteGlobalConfig.registerTool(souffleurAskQuestionTool, souffleurAskQuestionHandler);
      // Depuis 0.13 la question posée et la réponse reçue laissent une trace
      // dans le fil (segment `question-receipt`) : avant, le panneau répondu
      // ne laissait rien et l'échange disparaissait du défilement.
      registerSegmentRenderer(questionReceiptRenderer);
      // Le résultat stocké est le JSON du contrat (ce que lit le modèle) ; le
      // reçu du plugin attend sa prose — conversion inverse dans l'adaptateur.
      aparteGlobalConfig.registerToolRenderer(SOUFFLEUR_ASK_QUESTION_TOOL_NAME, {
        render: (segment) =>
          buildReceipt({
            input: segment.toolCall.input,
            result: askQuestionReceiptText(segment.result, segment.toolCall.input),
          }),
      });

      // Les 9 outils du contrat (search_knowledge/remember = leurres RAG, non
      // enregistrés : ils restent hors de la liste d'activation).
      aparteGlobalConfig.registerTool(readFileTool, readFileHandler);
      aparteGlobalConfig.registerTool(writeFileTool, writeFileHandler);
      aparteGlobalConfig.registerTool(computeTool, computeHandler);
      aparteGlobalConfig.registerTool(createWidgetTool, createWidgetHandler);
      aparteGlobalConfig.registerTool(transformFileTool, transformFileHandler);
      aparteGlobalConfig.registerTool(setReminderTool, setReminderHandler);

      // Sans renderer dédié, la lib n'affiche que le nom de l'outil : l'erreur
      // du survol (file_id inconnu, image, lecture impossible) restait muette.
      aparteGlobalConfig.registerToolRenderer('read_file', readFileRenderer);
      aparteGlobalConfig.registerToolRenderer('write_file', artifactCardRenderer);
      aparteGlobalConfig.registerToolRenderer('transform_file', artifactCardRenderer);
      aparteGlobalConfig.registerToolRenderer('create_widget', widgetRenderer);
      aparteGlobalConfig.registerToolRenderer('compute', invisibleRenderer);
      // La lib n'injecte les styles des tool renderers qu'au tool-start (live) —
      // au reload il n'y en a pas : injection à l'enregistrement.
      installToolRendererStyles();

      // Persistance des pièces jointes : sans elle la Map du fileRegistry est
      // vide au reload → bloc « Files available » vide et tous les file_id de
      // l'historique « inconnus » (les images « disparaissaient »).
      // Table dédiée : ces ids sont ceux que le modèle recopie, indépendants
      // du cycle de vie des conversations (cf. SouffleurFileRow).
      setFileStore({
        put: (entry) =>
          conversationAdapter.db.souffleurFiles.put({
            id: entry.id,
            name: entry.name,
            type: entry.type,
            mimeType: entry.mime,
            blob: entry.blob,
            addedAt: entry.addedAt,
            convId: entry.convId ?? null,
          }),
        loadAll: async () => {
          const rows = await conversationAdapter.db.souffleurFiles.orderBy('addedAt').toArray();
          return rows
            .filter((row) => !!row.blob)
            .map((row) => ({
              id: row.id,
              name: row.name,
              type: row.type || extType(row.name, row.mimeType),
              mime: row.mimeType,
              blob: row.blob,
              addedAt: row.addedAt,
              // `undefined` conserve tel quel : c'est une ligne d'avant le
              // rattachement, a distinguer de `null` (en attente d'adoption).
              convId: row.convId,
            }));
        },
        remove: (id) => conversationAdapter.db.souffleurFiles.delete(id),
        clear: () => conversationAdapter.db.souffleurFiles.clear(),
      });

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
          const composer = (event.target as HTMLElement | null)?.closest?.('aparte-composer') as
            (HTMLElement & { attachments?: File[] }) | null;
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
      // Rattache chaque fichier joint a son fil. Sans ce resolveur, le bloc
      // « Files available » annonce au modele TOUS les fichiers jamais joints,
      // dans n'importe quelle conversation. Pose avant le premier envoi : le
      // registre le consulte a l'enregistrement et a la construction du bloc.
      setConversationResolver(() => manager.activeId() || null);
      const settings = inject(SettingsService);
      await Promise.all([
        manager.init(conversationAdapter),
        settings.init(conversationAdapter),
        // AVANT tout envoi : le bloc « Files available » et la résolution des
        // file_id par les outils sont synchrones, la Map doit être pleine.
        fileRegistry.hydrate(),
      ]);
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // Ne concurrence jamais le téléchargement du modèle au premier lancement.
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ];
}
