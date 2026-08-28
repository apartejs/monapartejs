# ADR-006 — COOP `same-origin` + COEP `credentialless` everywhere

- **Date**: 2026-07-24
- **Status**: accepted
- **Context**: without cross-origin isolation there is no `SharedArrayBuffer`, hence no
  multi-threaded WebAssembly, hence unusable inference — and no error message.
- **Decision**: both headers are sent on every response, in dev (`angular.json`) and in
  prod (`docker/nginx.conf`). COEP `credentialless`, not `require-corp`: weights come
  from huggingface.co and the wasm runtime from jsdelivr, neither of which sets
  `Cross-Origin-Resource-Policy`.
- **Consequences**: every embedded native viewer (PDF, third-party iframe) is suspect
  under COEP — hence the PDF preview rendered on a canvas by pdf.js. First check of any
  diagnosis: `crossOriginIsolated === true`.
- **Evidence / references**: `docs/DEPLOY-COOLIFY.md` §4; journal of 2026-07-25 (native
  viewer blocked).
