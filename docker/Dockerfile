# Image de service de monaparte — build multi-étages, autonome.
#
# Le `dist/` est construit DANS l'image : c'est indispensable pour Coolify (et
# toute CI qui part du dépôt nu), qui n'a pas de build local à copier. L'ancienne
# version copiait `dist/monaparte/browser` depuis le contexte et échouait donc
# sur un clone frais.
#
#   docker build -f docker/Dockerfile -t monaparte .
#   docker run --rm -p 8080:80 monaparte
#
# Coolify : Build Pack = Dockerfile, Dockerfile Location = docker/Dockerfile,
# Port = 80. Voir docs/DEPLOY-COOLIFY.md.

# ── Étage build ───────────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app

# pnpm via corepack, version épinglée sur celle du lockfile (v9 → pnpm 10).
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# Dépendances d'abord : cette couche ne se reconstruit que si les manifestes
# changent, pas à chaque modification de source.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── Étage service ─────────────────────────────────────────────────────────────
FROM nginx:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/monaparte/browser /usr/share/nginx/html
EXPOSE 80

# Le conteneur ne sert que du statique : pas d'état, pas de volume. Tout le
# modèle vit dans le Cache API du navigateur du visiteur.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://localhost/index.html || exit 1
