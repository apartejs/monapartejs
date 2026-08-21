# Dockerfile de DÉPLOIEMENT — ne construit rien, il tire.
#
# Le vrai build vit dans `docker/Dockerfile` et tourne en CI (GitHub Actions),
# qui publie `ghcr.io/apartejs/monapartejs:main`. Ce fichier-ci existe pour que
# Coolify reste en Build Pack **Dockerfile**, où le champ « Domains » de
# l'application suffit à router.
#
# Pourquoi ne pas rester en Docker Compose : en mode Compose, Coolify rattache
# le domaine PAR SERVICE et Traefik répondait 503 sans backend, malgré un
# conteneur démarré et `SERVICE_FQDN_WEB_80` déclaré. Le mode Dockerfile, lui,
# routait déjà correctement — son seul échec d'origine était un `COPY` d'un
# `dist/` absent, jamais le domaine. On revient donc au mode qui marche, sans
# rendre le build au serveur.
#
# Coolify :
#   Build Pack            = Dockerfile
#   Dockerfile Location   = /Dockerfile
#   Port                  = 80
#
# À la racine et sous ce nom, pour coller à la convention qui fonctionne déjà
# sur ce Coolify (apartejs : `Dockerfile Location = /Dockerfile.docs`).
#
# La config nginx (COOP/COEP, fallback SPA, cache) est déjà DANS l'image tirée.
# Retour arrière : remplacer `:main` par un tag `:sha-abc1234` publié par la CI.

FROM ghcr.io/apartejs/monapartejs:main
