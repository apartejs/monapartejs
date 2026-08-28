# Decisions

One decision per file, short, dated, with what motivated it. A decision is not reopened
without new data — when the data arrives, a new decision supersedes the old one; history
is not rewritten.

| # | Decision | Status |
|---|---|---|
| [001](001-consume-the-library-from-npm.md) | Consume `@aparte/*` from npm; Angular 19 standalone, no nx | accepted |
| [002](002-persistence-in-the-app.md) | Persistence lives in the app (Dexie), not in the library | accepted |
| [003](003-contract-verbatim.md) | The training contract is ported verbatim and regenerated, never rephrased | accepted |
| [004](004-one-model-hot-swapped-lora-manifest.md) | One model, hot-swapped LoRA adapters, versioned by `manifest.json` | accepted |
| [005](005-routing-inside-the-model.md) | Routing lives in the model; tools without data stay out of the list | accepted |
| [006](006-coop-coep-credentialless.md) | COOP `same-origin` + COEP `credentialless` everywhere | accepted |
| [007](007-build-on-github-coolify-pulls.md) | The build runs on GitHub; Coolify only pulls the image | accepted |
| [008](008-browser-validation-and-branches.md) | Nothing merges without browser validation; `main` deploys, so work happens on branches | accepted |
| [009](009-english-repository.md) | The repository is in English; model-facing text keeps the contract's language | accepted |
| [010](010-bp-prefixes-kept.md) | The `bp-`/`bp.` prefixes are kept, not migrated | proposed |
| [011](011-scope-of-1-0.md) | Scope of 1.0: prove what exists, do not extend it | proposed |

Format: [000-template.md](000-template.md).
