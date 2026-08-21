# Déployer monaparte — build sur GitHub, service sur Coolify

L'app est **100 % statique** : nginx sert un bundle, et tout le modèle (base
834 Mo, adapters, tour vision 269 Mo) est téléchargé par le navigateur du
visiteur depuis Hugging Face et vit dans son Cache API. Le conteneur n'a donc
**aucun état, aucun volume, aucune variable d'environnement**.

Le serveur ne coûte presque rien, mais le premier chargement d'un visiteur tire
~1,1 Go depuis `huggingface.co` — pas depuis chez nous.

## Le découpage

```
push sur main
   └─ GitHub Actions (.github/workflows/deploy.yml)
        ├─ verify : types app + types WORKER + tests
        ├─ image  : docker build → ghcr.io/apartejs/monapartejs:main
        └─ deploy : webhook Coolify
              └─ Coolify fait `docker compose pull` et sert l'image
```

Le build tourne sur GitHub, pas sur le serveur : un build Angular en production
demande plusieurs Go de RAM, et le N100 fait déjà tourner une quinzaine de
conteneurs. Le serveur ne fait que tirer une image de quelques dizaines de Mo.

---

## 1. La ressource Coolify

| Réglage | Valeur |
|---|---|
| Build Pack | **Docker Compose** |
| Docker Compose Location | `/docker-compose.yml` |
| Domains for `web` | `https://mon.apartejs.dev/` |
| Ports Exposes | `80` |
| UUID | `ewd1i4v2hua9nk4zk3ytvb73` |

En mode Compose, le domaine se règle **par service** (champ « Domains for web »),
pas au niveau de l'application — le champ `fqdn` de l'app garde sa valeur
sslip.io générée, c'est normal et sans effet.

**Pourquoi Compose et pas un Dockerfile `FROM ghcr.io/...:main`** : ce montage
est structurellement cassé. Docker ne re-télécharge pas un `FROM` sur un tag
mutable s'il l'a en cache (`--pull` requis, que Coolify ne passe pas), et même
après un `docker pull` manuel le cache BuildKit réutilise la couche `FROM` déjà
résolue puisque le Dockerfile n'a pas changé. Mesuré : Coolify reconstruisait
fidèlement le bon commit par-dessus une image vieille de 42 minutes, en boucle.
Un compose sans clé `build:` ne construit rien.

**Mais le compose seul ne suffit pas : il lui faut `pull_policy: always`.**
Coolify ne lance jamais `docker compose pull`. Son étape « Pulling & building
required images » lance `docker compose build`, qui n'a rien à faire ici — 0,2 s
au chronomètre. Reste `docker compose up`, dont la politique par défaut est
`missing` : l'image du déploiement précédent est encore sur le disque, donc il
la réutilise. Le conteneur est recréé, le déploiement finit en `finished`, et le
site sert l'ancien code sans que rien ne signale l'anomalie. Mesuré le 21/08 :
trois déploiements successifs ont servi la même image, celle de 14:41.

**Visibilité du paquet GHCR** : un paquet publié par Actions est privé par
défaut, même depuis un dépôt public, et le `pull` échoue alors en
`unauthorized`. Le passer en public, ou renseigner Coolify → *Keys & Tokens* →
*Docker Registries* avec un PAT `read:packages`.

---

## 2. Déploiement automatique

Deux secrets dans le dépôt → *Settings* → *Secrets and variables* → *Actions* :

| Secret | Valeur |
|---|---|
| `COOLIFY_WEBHOOK_URL` | `https://coolify.paulrichez.fr/api/v1/deploy?uuid=ewd1i4v2hua9nk4zk3ytvb73` |
| `COOLIFY_TOKEN` | un jeton API Coolify dédié (*Keys & Tokens* → *API tokens*) |

Sans eux, le workflow réussit quand même : l'image est publiée et le
déploiement reste manuel, avec une note dans le résumé du run. S'ils sont posés
et que le webhook répond hors 2xx, le job échoue — un déploiement
silencieusement non déclenché ne doit pas passer pour un succès.

⚠️ **Ne pas utiliser un webhook git « on push »** : il déclenche le déploiement
AVANT que la CI ait publié l'image, donc Coolify tire l'image précédente. Le
site sert alors l'ancien code, sans erreur et sans rien dans les logs.

---

## 3. Le piège qui a coûté une soirée : le healthcheck

**Symptôme** : Traefik répond `503`, avec `CN=TRAEFIK DEFAULT CERT` (Let's
Encrypt n'émet pas) et aucun en-tête `cross-origin` — alors que le conteneur
tourne et que nginx loggue `start worker processes`.

**Cause** : le healthcheck visait `http://localhost/`. `localhost` résout
d'abord en `::1`, et notre `nginx.conf` n'écoutait qu'en IPv4. Le script
d'entrée de nginx ajoute normalement `listen [::]:80` tout seul, mais s'en
abstient dès que la config diffère de la sienne — ce qu'il annonce dans les
logs : « /etc/nginx/conf.d/default.conf differs from the packaged version ».
Donc healthcheck en échec → conteneur `unhealthy` → **Coolify refuse de
router** → 503, et pas de certificat.

Corrigé des deux côtés : healthcheck sur `127.0.0.1`, et `listen [::]:80`
explicite dans `docker/nginx.conf`.

**La leçon** : un 503 de Traefik ne veut pas dire « problème de routage ». Lire
l'état réel AVANT de toucher à la configuration :

```bash
ssh -i ~/.ssh/id_ed25519_n100 paul@192.168.1.32     # LAN uniquement, docker sans sudo
docker ps --format '{{.Names}}\t{{.Status}}'         # (unhealthy) ?
docker inspect --format '{{json .State.Health}}' <conteneur>
```

Ou, plus court, via le MCP Coolify : `list_applications` montre
`status: running:unhealthy` et le `fqdn` réel en une requête.

---

## 4. COOP/COEP — l'autre chose qui casse en silence

`docker/nginx.conf` émet sur toutes les réponses :

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Sans elles : pas de `SharedArrayBuffer`, donc pas de wasm multi-thread, donc une
inférence lente au point d'être inutilisable — **sans aucun message d'erreur**.

`credentialless` et non `require-corp`, délibérément : l'app charge en
cross-origin les poids depuis `huggingface.co` et le runtime wasm d'ONNX Runtime
depuis `cdn.jsdelivr.net`. `require-corp` exigerait de leur part un
`Cross-Origin-Resource-Policy` qu'on ne contrôle pas.

Contrôle, avant tout test fonctionnel :

```bash
curl -sI https://mon.apartejs.dev/ | grep -i cross-origin   # les deux lignes
```

Et dans la console : `crossOriginIsolated === true`.

HTTPS n'est pas optionnel non plus — WebGPU et `SharedArrayBuffer` exigent un
contexte sécurisé.

---

## 5. Ordre de vérification après déploiement

0. **la fraîcheur de l'image** — le contrôle qui manquait, et le seul qu'un
   déploiement vert ne garantit pas :

   ```bash
   curl -sI https://mon.apartejs.dev/ | grep -i last-modified   # ~= l'heure du build
   ```

   Une date antérieure au dernier build de la CI veut dire que le `pull` n'a pas
   eu lieu. Vérifier `pull_policy: always` dans `docker-compose.yml`.

1. les deux en-têtes (`curl` ci-dessus) et un `200` ;
2. l'onboarding annonce le téléchargement, **tour vision comprise** (le total
   est lu du `manifest.json` de HF) ;
3. laisser descendre le modèle, envoyer un message ;
4. joindre une image et demander ce qu'elle contient : la carte `read_file` doit
   afficher une description, pas une erreur ;
5. recharger : l'image doit toujours être là, le fil intact ;
6. `/debug/prompt` montre le dernier échange, avec le bloc `List of tools`.

Les traces console sont silencieuses en production (elles suivent
`isDevMode()`). Pour diagnostiquer sur le site déployé :
`localStorage.setItem('bp.debug','1')` puis recharger.

---

## 6. Revenir en arrière

Chaque build publie aussi un tag court par commit (`sha-abc1234`). Remplacer
`:main` par ce tag dans `docker-compose.yml` et redéployer.
