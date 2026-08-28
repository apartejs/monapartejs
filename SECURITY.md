# Security policy

## What the application does

Everything runs in the visitor's browser: there is no inference server, no account, no
data sent anywhere. The server only serves static files.

The application does, however, execute **code produced by the model** — computations,
PDFs, widgets — inside sandboxes:

- `compute` and `write_file(pdf)`: a fresh Worker per execution, no network access, hard
  timeout (`src/app/souffleurs/executors/sandbox.ts`);
- `create_widget`: a `sandbox` iframe with an opaque origin;
- attached files (xlsx, docx, pdf, images) are parsed by third-party libraries in the main
  thread or a worker.

## Scope

In scope: any sandbox escape, any execution of generated code outside a sandbox, any
exfiltration (network, another origin's storage), any unsanitised rendering of content
produced by the model or by an attached file.

Out of scope: the model's own behaviour (wrong answers, refusals, ill-timed tool calls),
and the `@aparte/*` library — see https://github.com/apartejs/aparte/security/policy.

## Reporting

Do not open a public issue. Use GitHub's private vulnerability reporting:
**https://github.com/apartejs/monapartejs/security/advisories/new**

Include a minimal reproduction. First response within a few days; a fix ships as a patch
release and is deployed to mon.apartejs.dev.

## Supported versions

Only the latest deployed version (`main`, soon tagged) receives fixes.
