# Deploying monaparte — build on GitHub, serve on Coolify

The app is **100 % static**: nginx serves a bundle, and the whole model (834 MB base,
adapters, 269 MB vision tower) is downloaded by the visitor's browser from Hugging Face and
lives in their Cache API. The container therefore has **no state, no volume, no
environment variable**.

The server costs almost nothing, but a visitor's first load pulls ~1.1 GB from
`huggingface.co` — not from us.

## The split

```
push to main
   └─ GitHub Actions (.github/workflows/deploy.yml)
        ├─ verify : lint + format + app types + WORKER types + tests
        ├─ image  : docker build → ghcr.io/apartejs/monapartejs:main
        └─ deploy : Coolify webhook
              └─ Coolify runs `docker compose pull` and serves the image
```

The build runs on GitHub, not on the server: a production Angular build needs several GB
of RAM, and the N100 already runs about fifteen containers. The server only pulls an image
of a few tens of MB.

---

## 1. The Coolify resource

| Setting | Value |
|---|---|
| Build Pack | **Docker Compose** |
| Docker Compose Location | `/docker-compose.yml` |
| Domains for `web` | `https://mon.apartejs.dev/` |
| Ports Exposes | `80` |
| UUID | `ewd1i4v2hua9nk4zk3ytvb73` |

In Compose mode, the domain is set **per service** ("Domains for web"), not at the
application level — the app's `fqdn` field keeps its generated sslip.io value; that is
normal and has no effect.

**Why Compose and not a Dockerfile `FROM ghcr.io/...:main`**: that setup is structurally
broken. Docker does not re-download a `FROM` on a mutable tag if it has it cached
(`--pull` required, which Coolify does not pass), and even after a manual `docker pull`
the BuildKit cache reuses the already-resolved `FROM` layer since the Dockerfile did not
change. Measured: Coolify faithfully rebuilt the right commit on top of a 42-minute-old
image, in a loop. A compose without a `build:` key builds nothing.

**But compose alone is not enough: it needs `pull_policy: always`.** Coolify never runs
`docker compose pull`. Its "Pulling & building required images" step runs
`docker compose build`, which has nothing to do here — 0.2 s on the stopwatch. What is
left is `docker compose up`, whose default policy is `missing`: the previous deployment's
image is still on disk, so it reuses it. The container is recreated, the deployment ends
`finished`, and the site serves the old code without anything flagging it. Measured on
2026-08-21: three successive deployments served the same image, the 14:41 one.

**GHCR package visibility**: a package published by Actions is private by default, even
from a public repository, and the `pull` then fails with `unauthorized`. Make it public,
or fill Coolify → *Keys & Tokens* → *Docker Registries* with a `read:packages` PAT.

---

## 2. Automatic deployment

Two secrets in the repository → *Settings* → *Secrets and variables* → *Actions*:

| Secret | Value |
|---|---|
| `COOLIFY_WEBHOOK_URL` | `https://coolify.paulrichez.fr/api/v1/deploy?uuid=ewd1i4v2hua9nk4zk3ytvb73` |
| `COOLIFY_TOKEN` | a dedicated Coolify API token (*Keys & Tokens* → *API tokens*) |

Without them the workflow still succeeds: the image is published and deployment stays
manual, with a note in the run summary. When they are set and the webhook answers outside
2xx, the job fails — a silently untriggered deployment must not pass for a success.

⚠️ **Do not use a git "on push" webhook**: it triggers the deployment BEFORE CI has
published the image, so Coolify pulls the previous one. The site then serves the old code,
with no error and nothing in the logs.

---

## 3. The trap that cost an evening: the healthcheck

**Symptom**: Traefik answers `503`, with `CN=TRAEFIK DEFAULT CERT` (Let's Encrypt does not
issue) and no `cross-origin` header — while the container runs and nginx logs `start
worker processes`.

**Cause**: the healthcheck targeted `http://localhost/`. `localhost` resolves to `::1`
first, and our `nginx.conf` only listened on IPv4. nginx's entrypoint normally adds
`listen [::]:80` by itself, but refrains as soon as the config differs from the packaged
one — which it announces in the logs: "/etc/nginx/conf.d/default.conf differs from the
packaged version". So healthcheck failing → container `unhealthy` → **Coolify refuses to
route** → 503, and no certificate.

Fixed on both sides: healthcheck on `127.0.0.1`, and an explicit `listen [::]:80` in
`docker/nginx.conf`.

**The lesson**: a Traefik 503 does not mean "routing problem". Read the real state BEFORE
touching the configuration:

```bash
ssh -i ~/.ssh/id_ed25519_n100 paul@192.168.1.32     # LAN only, docker without sudo
docker ps --format '{{.Names}}\t{{.Status}}'         # (unhealthy) ?
docker inspect --format '{{json .State.Health}}' <container>
```

Or, shorter, through the Coolify MCP: `list_applications` shows
`status: running:unhealthy` and the real `fqdn` in one request.

---

## 4. COOP/COEP — the other thing that breaks silently

`docker/nginx.conf` sends on every response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Without them: no `SharedArrayBuffer`, hence no multi-threaded wasm, hence inference too
slow to be usable — **with no error message at all**.

`credentialless` and not `require-corp`, deliberately: the app loads weights cross-origin
from `huggingface.co` and the ONNX Runtime wasm from `cdn.jsdelivr.net`. `require-corp`
would require a `Cross-Origin-Resource-Policy` from them that we do not control.

Check, before any functional test:

```bash
curl -sI https://mon.apartejs.dev/ | grep -i cross-origin   # both lines
```

And in the console: `crossOriginIsolated === true`.

HTTPS is not optional either — WebGPU and `SharedArrayBuffer` require a secure context.

---

## 5. Post-deployment checklist

0. **image freshness** — the check that was missing, and the only one a green deployment
   does not guarantee:

   ```bash
   curl -sI https://mon.apartejs.dev/ | grep -i last-modified   # ≈ build time
   ```

   A date earlier than the last CI build means the `pull` did not happen. Check
   `pull_policy: always` in `docker-compose.yml`.

1. both headers (`curl` above) and a `200`;
2. onboarding announces the download, **vision tower included** (the total is read from the
   HF `manifest.json`);
3. let the model download, send a message;
4. attach an image and ask what it shows: the `read_file` card must display a description,
   not an error;
5. reload: the image must still be there, the thread intact;
6. `/debug/prompt` shows the last exchange, with the `List of tools` block.

Console traces are silent in production (they follow `isDevMode()`). To diagnose on the
deployed site: `localStorage.setItem('bp.debug','1')` then reload.

---

## 6. Rolling back

Every build also publishes a short per-commit tag (`sha-abc1234`). Replace `:main` with
that tag in `docker-compose.yml` and redeploy.
