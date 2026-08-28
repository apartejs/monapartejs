# monaparte serving image — multi-stage, self-contained.
#
# `dist/` is built INSIDE the image: this is essential for Coolify (and any CI
# starting from a bare clone), which has no local build to copy in. The old
# version copied `dist/monaparte/browser` from the context and therefore
# failed on a fresh clone.
#
#   docker build -f docker/Dockerfile -t monaparte .
#   docker run --rm -p 8080:80 monaparte
#
# Coolify: Build Pack = Dockerfile, Dockerfile Location = docker/Dockerfile,
# Port = 80. See docs/DEPLOY-COOLIFY.md.

# ── Build stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# pnpm via corepack, version pinned to the one in the lockfile (v9 -> pnpm 10).
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Dependencies first: this layer only rebuilds when the manifests change,
# not on every source change.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── Serving stage ────────────────────────────────────────────────────────────
FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
# The conf is validated AT BUILD TIME. Without this, a syntax error only shows
# up when the container starts: it loops, goes `unhealthy`, Coolify refuses to
# route, and the visible symptom is a Traefik 503 that says nothing about its
# cause. Lived on 21/08 for a similar reason. Here the build fails instead,
# with the line number.
RUN nginx -t
COPY --from=build /app/dist/monaparte/browser /usr/share/nginx/html
EXPOSE 80

# The container only serves static files: no state, no volume. The whole
# model lives in the visitor's browser Cache API.
# 127.0.0.1 and NOT localhost: `localhost` resolves to ::1 first, and a
# custom nginx config doesn't necessarily listen on IPv6 (the entrypoint
# script only adds `listen [::]:80` when the config is the packaged one).
# The healthcheck was therefore failing with "Connection refused", the
# container went `unhealthy`, and Coolify refused to route -> 503 on the
# Traefik side. Belt and braces: nginx.conf now also listens on IPv6.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://127.0.0.1/index.html || exit 1
