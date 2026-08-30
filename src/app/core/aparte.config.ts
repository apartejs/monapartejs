/**
 * The wiring for the apartéJS lib: transport, plugins, tools, client and
 * conversation manager. Since aparté 0.8 the config is no longer a class with
 * statics — `AparteConfig` is the TYPE, `aparteGlobalConfig` the page's
 * instance, the same one `provideAparte` writes to.
 *
 * Registration goes through here, but three modules touch the instance on
 * their own because they SET a render, not a configuration: `mascotte/`
 * (status + error), `souffleurs/tools/tool-renderers` (live highlighting) and
 * `core/i18n/translate.service` (locale switch).
 */
import { inject, isDevMode, provideAppInitializer, type EnvironmentProviders } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { ConversationManagerService, provideAparte } from '@aparte/angular';
import { AparteDirectTransport, aparteGlobalConfig, registerSegmentRenderer } from '@aparte/core';
import type { AparteMessage } from '@aparte/core';
import { fr } from '@aparte/locale-fr';
import { buildReceipt, questionReceiptRenderer } from '@aparte/plugin-ask-user';
import { createCompactionSelector, setupCompaction } from '@aparte/plugin-compaction';
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
import { buildCompactionDigest } from './compaction-digest';
import { TranslateService } from './i18n/translate.service';
import { LinkGuardService } from './link-guard.service';
import { RichRenderService } from './rich-render.service';

/** Shared adapter (conversations + settings + export/import). */
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
      // Lib locale: fr explicit, en = built-in default.
      ...(currentLocale() === 'fr' ? { locale: fr } : {}),
      clientOptions: {
        // Bound on the souffleurs contract's agentic loop (MAX_AGENTIC_ITERATIONS).
        maxTurns: 6,
        // Attached files go through the system prompt's "Files available"
        // block, never inlined as base64 in the messages.
        rawFileInject: 'none',
        requestInterceptor: (request) => ({
          ...request,
          _meta: { ...request._meta, souffleurFiles: fileRegistry.listForWire() },
        }),
      },
    }),
    provideAppInitializer(async () => {
      // In dev, thread traces (prompt wire, raw output, parsed calls) are on
      // by default: it's the mode where we debug, we shouldn't have to
      // remember a flag. `bp.debug` stays an explicit override.
      setSouffleurDebug(isDevMode());

      aparteGlobalConfig.setTransport(new AparteDirectTransport({ byok: true }));
      // Since aparté 0.5, ALL actions except `copy` are disabled by default:
      // the lib only renders what someone honors ("a button nobody answers
      // is a lie told to the user"). So we enable what we handle:
      //  - retry/edit: handled by AparteClient, needed for branches;
      //  - info: the "i" button emits `aparte-message-info`, listened to by
      //    ChatPageComponent which opens the stats popover. The popover and
      //    its listener already existed — only the activation was missing,
      //    so the button had disappeared with the move to 0.5.
      // Lib reminder: `info` only shows if the message carries a `usage`.
      aparteGlobalConfig.setBubbleActions({ retry: true, edit: true, info: true });

      // Compaction. The gauge (<aparte-context auto-compact> in the chat) asks
      // at 90 % of the window; this answers.
      //
      // `summarize` REPLACES the model call, and that is deliberate, not a
      // shortcut. Two reasons, in order:
      //  1. Measured (souffleur-chat 0.3.0, 6 generations): asked to summarise,
      //     the model refuses, answers as if continuing the chat, or invents —
      //     one run produced a second client's amounts found nowhere in the
      //     transcript. See FRICTIONS-MODELE.local.md.
      //  2. It could not have worked anyway: the plugin puts its instruction in
      //     a `system` message, and our provider imposes the contract's own
      //     system prompt while buildWirePrompt drops the rest. The instruction
      //     never reached the model. Going through `summarize` sidesteps the
      //     transport entirely, so the verbatim contract is untouched.
      //
      // The selector stays the library's, budget-aware over the 32k the model
      // now declares: it keeps the newest turns that still fit. We capture what
      // it drops so the digest reads the real messages rather than parsing the
      // flattened prose back out — the plugin runs one compaction at a time, so
      // the capture cannot interleave.
      const i18n = inject(TranslateService);
      let lastDropped: AparteMessage[] = [];
      const budgeted = createCompactionSelector({
        contextWindow: () => aparteGlobalConfig.getCurrentModel()?.contextWindow,
        systemPrompt: () => aparteGlobalConfig.resolveSystemPrompt(),
        tools: () => aparteGlobalConfig.getTools(),
      });
      setupCompaction({
        selector: (messages) => {
          const selection = budgeted(messages);
          lastDropped = selection.drop;
          return selection;
        },
        summarize: async () => {
          // Consumed, not just read: should a summarise ever run without the
          // selector having just run, the digest comes out empty — and the plugin
          // treats an empty summary as a failure ("Empty summary returned by
          // model"), so the compaction reports `aparte-compact-error` and leaves
          // the transcript untouched. That is the outcome we want: a stale digest
          // would state facts about ANOTHER compaction, in a notice the model then
          // reads as true.
          const dropped = lastDropped;
          lastDropped = [];
          return buildCompactionDigest(dropped, i18n.t().compaction);
        },
      });

      setupMarkedProvider();
      setupStreamingMarkdownProvider();
      // Shiki loads its languages on demand — doesn't block boot.
      // A theme pair: one theme paints one scheme, and the default github-dark
      // sat as a dark slab inside the light chat (aparté 0.14 changelog).
      void setupShikiProvider({ theme: { light: 'github-light', dark: 'github-dark' } });

      // No `setupAskUser()`: it would register the tool under the plugin's
      // name (`ask_user`), which the model never emits, and the receipt
      // renderer under that same key. So we redo its three gestures by hand,
      // under the contract's name. The shim (multi_select→multiple, options
      // string[]→{title}[]) is in the adapter.
      aparteGlobalConfig.registerTool(souffleurAskQuestionTool, souffleurAskQuestionHandler);
      // Since 0.13 the question asked and the answer received leave a trace
      // in the thread (`question-receipt` segment): before, the answered
      // panel left nothing and the exchange disappeared from the scroll.
      registerSegmentRenderer(questionReceiptRenderer);
      // The stored result is the contract's JSON (what the model reads); the
      // plugin's receipt expects its prose — reverse conversion in the adapter.
      aparteGlobalConfig.registerToolRenderer(SOUFFLEUR_ASK_QUESTION_TOOL_NAME, {
        render: (segment) =>
          buildReceipt({
            input: segment.toolCall.input,
            result: askQuestionReceiptText(segment.result, segment.toolCall.input),
          }),
      });

      // The contract's 9 tools (search_knowledge/remember = RAG decoys, not
      // registered: they stay out of the activation list).
      aparteGlobalConfig.registerTool(readFileTool, readFileHandler);
      aparteGlobalConfig.registerTool(writeFileTool, writeFileHandler);
      aparteGlobalConfig.registerTool(computeTool, computeHandler);
      aparteGlobalConfig.registerTool(createWidgetTool, createWidgetHandler);
      aparteGlobalConfig.registerTool(transformFileTool, transformFileHandler);
      aparteGlobalConfig.registerTool(setReminderTool, setReminderHandler);

      // Without a dedicated renderer, the lib only shows the tool name: the
      // hover error (unknown file_id, image, unreadable) stayed silent.
      aparteGlobalConfig.registerToolRenderer('read_file', readFileRenderer);
      aparteGlobalConfig.registerToolRenderer('write_file', artifactCardRenderer);
      aparteGlobalConfig.registerToolRenderer('transform_file', artifactCardRenderer);
      aparteGlobalConfig.registerToolRenderer('create_widget', widgetRenderer);
      aparteGlobalConfig.registerToolRenderer('compute', invisibleRenderer);
      // The lib only injects tool renderer styles on tool-start (live) —
      // on reload there is none: inject at registration instead.
      installToolRendererStyles();

      // Persistence of attachments: without it the fileRegistry's Map is
      // empty on reload → empty "Files available" block and every file_id
      // from the history "unknown" (images "disappeared").
      // Dedicated table: these ids are the ones the model copies back,
      // independent of the conversations' lifecycle (cf. SouffleurFileRow).
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
              // `undefined` keeps it as-is: it's a row from before the
              // attachment feature, to be distinguished from `null` (pending adoption).
              convId: row.convId,
            }));
        },
        remove: (id) => conversationAdapter.db.souffleurFiles.delete(id),
        clear: () => conversationAdapter.db.souffleurFiles.clear(),
      });

      // Persistence of produced artifacts (blob + preview) — needed to
      // rehydrate the cards after a reload (the in-memory Map is empty).
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
        // msgId not indexed: plain scan (small artifacts table).
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

      // Capture attachments AT SEND TIME: aparte-send's detail doesn't carry
      // them, but the source composer exposes them.
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
      // Attaches each joined file to its thread. Without this resolver, the
      // "Files available" block would announce to the model EVERY file ever
      // attached, in any conversation. Set before the first send: the
      // registry consults it at registration and when building the block.
      setConversationResolver(() => manager.activeId() || null);
      const settings = inject(SettingsService);
      await Promise.all([
        manager.init(conversationAdapter),
        settings.init(conversationAdapter),
        // BEFORE any send: the "Files available" block and the resolution of
        // file_id by the tools are synchronous, the Map must be full.
        fileRegistry.hydrate(),
      ]);
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // Never competes with the model download on first launch.
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ];
}
