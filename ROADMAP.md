# Roadmap

## What 1.0 is

**Monaparté 1.0 is the public, stable showcase of aparté.** A visitor on Chrome or Edge
with WebGPU arrives, understands within ten seconds that nothing leaves their device,
downloads the model, chats, attaches a file, gets a document or a chart back, reloads the
page and finds everything still there. On a browser without WebGPU or without cross-origin
isolation, they get a clear message — not silence.

In 1.0: what exists today — seven active tools (`read_file` including images, `write_file`
xlsx/docx/pdf, `compute`, `create_widget`, `transform_file`, `set_reminder`,
`ask_question`), PWA, fr/en interface, export/import — made **proven** (component tests,
automated browser journey, recorded validation) and **faithful** to the model's training
contract.

Explicitly out of 1.0:

- document search (`search_knowledge`) — no corpus, and the model was only ever trained
  on it negatively;
- memory (`remember`) — no positive example in the data;
- extracting modules into `@aparte/*` plugins — after 1.0, which serves as their reference
  client;
- Angular 20+ — when `@aparte/angular` moves its peers;
- full Firefox and Safari support — graceful degradation only.

The model's measured limits (it may deny being able to read files when asked what it can
do; it sometimes reads an attached file nobody asked it to read; it freely translates an
English tool result) are **documented, not fixed** here: they are fixed in training, in
another repository.

## Steps

| # | Step | Verifiable output |
|---|---|---|
| 0 | Restart: `@aparte` 0.13.1 validated in the browser, licence, repository governance | clean `main`, green `pnpm verify` |
| 1 | Versioned framing: decisions in `docs/decisions/`, issues and a `v1.0.0` milestone | a fresh clone knows where this is going |
| 2 | Contract fidelity: the runtime ↔ training gaps reported by the lab are closed, contract fixtures under test | a future gap breaks CI |
| 3 | Safety net: lint, component tests, Playwright journey with a mocked model, CI on PRs | a breaking library bump is blocked before merge |
| 4 | Finish: error states (no WebGPU, no isolation, quota, offline), complete i18n, basic accessibility, visible version | full journey by a third party on a clean machine |
| 5 | Release 1.0.0: changelog, tag, `v1.0.0` image, announcement | `v1.0.0` in production |

## After 1.0

1. `@aparte/provider-souffleurs` — the provider, the worker, the wire contract.
2. `@aparte/plugin-storage-indexeddb` — the Dexie adapter.
3. A new training pass in the lab → new `manifest.json` → zero change here (that is what
   manifest-based versioning is for).
4. Memory, then document search, once the data exists.
