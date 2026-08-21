# Déployer monaparte — build sur GitHub, service sur Coolify

L'app est **100 % statique** : nginx sert un bundle, et tout le modèle (base
834 Mo, adapters, tour vision 269 Mo) est téléchargé par le navigateur du
visiteur depuis Hugging Face et vit dans son Cache API. Le conteneur n'a donc
**aucun état, aucun volume, aucune variable d'environnement**.

À garder en tête : le serveur ne coûte presque rien, mais **le premier
chargement d'un visiteur tire ~1,1 Go depuis huggingface.co** — pas depuis chez
nous.

## Le découpage

```
push sur main
   └─ GitHub Actions (.github/workflows/deploy.yml)
        ├─ verify : types app + types WORKER + tests
        ├─ image  : docker build → ghcr.io/apartejs/monapartejs:main
        └─ deploy : webhook Coolify
              └─ Coolify tire l'image et la sert
```

**Le build tourne sur GitHub, pas sur le serveur Coolify.** Un build Angular en
production dépasse volontiers 2 Go de RAM ; le faire sur une petite instance,
c'est s'exposer à un `Killed` sans message clair. Les runners GitHub ont la
place, et le serveur ne fait plus que tirer une image de quelques dizaines de Mo.

---

## 1. La ressource Coolify

Tu as déjà une application git avec **Build Pack = Dockerfile**, et c'est elle
qui a produit l'échec `COPY dist/bonaparte/browser: not found` : elle
construisait depuis le dépôt.

⚠️ **« Docker Image » n'est pas dans le menu déroulant** d'une application git :
c'est un *type de ressource* à créer. Inutile d'en créer une — le Build Pack
**Docker Compose**, lui, est bien dans le menu de la ressource existante, et un
compose qui ne déclare qu'une `image:` (sans clé `build:`) **ne construit rien,
il tire**.

Sur la ressource actuelle, deux réglages :

| Réglage | Valeur |
|---|---|
| Build Pack | **Docker Compose** |
| Docker Compose Location | `/docker-compose.yml` |
| Domains | `https://mon.apartejs.dev` (inchangé) |

Le port et le healthcheck viennent du compose ; Coolify pose les labels Traefik
et le certificat à partir du domaine. Aucune variable, aucun volume : le
conteneur est sans état.

**Visibilité du paquet GHCR.** Par défaut, un paquet publié par Actions est
**privé**, et le `pull` échoue en `unauthorized`. Deux options :
- le passer en **public** (GitHub → le paquet → *Package settings* →
  *Change visibility*) ;
- le laisser privé et ajouter les identifiants du registre dans Coolify
  (**Keys & Tokens** → *Docker Registries*), avec un PAT ayant `read:packages`.

Le paquet n'apparaît qu'**après le premier passage réussi** du job `image`.

## 2. Les deux secrets GitHub

Sans eux, l'image est quand même publiée et le workflow réussit — seul le
déclenchement automatique est sauté, avec une note dans le résumé du run.

Dans le dépôt → *Settings* → *Secrets and variables* → *Actions* :

| Secret | Où le trouver |
|---|---|
| `COOLIFY_WEBHOOK_URL` | Coolify → la ressource → *Webhooks* → l'URL de déploiement (`https://<coolify>/api/v1/deploy?uuid=…`) |
| `COOLIFY_TOKEN` | Coolify → *Keys & Tokens* → *API tokens* → un jeton avec le droit de déployer |

Le job échoue si le webhook répond hors 2xx : un déploiement silencieusement non
déclenché ne doit pas passer pour un succès.

---

## 3. Domaine et HTTPS

Le domaine est déjà redirigé depuis OVH vers l'IP de Coolify, et renseigné dans
la ressource. À vérifier seulement :

1. que le FQDN porte bien le schéma dans **Domains** : `https://mon.apartejs.dev` —
   c'est le `https://` qui déclenche la génération Let's Encrypt par Traefik ;
2. laisser le certificat s'émettre ;
3. vérifier que ça répond en HTTPS **avant** de tester l'app.

**HTTPS n'est pas optionnel ici** : WebGPU et `SharedArrayBuffer` exigent un
contexte sécurisé. En HTTP simple, le modèle ne se charge pas — ou tombe en wasm
mono-thread, beaucoup plus lent, sans message d'erreur.

---

## 4. Le point qui casse tout si on l'oublie : COOP/COEP

`docker/nginx.conf` émet sur **toutes** les réponses :

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Sans ces deux en-têtes : pas de `SharedArrayBuffer`, donc pas de wasm
multi-thread, donc une inférence lente au point d'être inutilisable.

`credentialless` et non `require-corp`, délibérément : l'app charge en
cross-origin les poids depuis `huggingface.co` et le runtime wasm d'ONNX Runtime
depuis `cdn.jsdelivr.net`. `require-corp` exigerait de leur part un
`Cross-Origin-Resource-Policy` qu'on ne contrôle pas.

Contrôle, **avant** tout test fonctionnel :

```bash
curl -sI https://mon.apartejs.dev/ | grep -i cross-origin   # les deux lignes
```

Et dans la console : `crossOriginIsolated === true`. Si Traefik réécrit les
en-têtes de sécurité, c'est ici que ça se voit — et nulle part ailleurs, l'app
ne prévenant pas.

---

## 5. Ordre de vérification après déploiement

1. les deux en-têtes (`curl` ci-dessus) ;
2. l'onboarding annonce le téléchargement, **tour vision comprise** (le total
   est lu du `manifest.json` de HF) ;
3. laisser descendre le modèle, envoyer un message ;
4. joindre une image et demander ce qu'elle contient : la carte `read_file` doit
   afficher une description, pas une erreur ;
5. recharger : l'image doit toujours être là, le fil intact ;
6. `/debug/prompt` montre le dernier échange, avec le bloc `List of tools`.

Les traces console sont **silencieuses en production** (elles suivent
`isDevMode()`). Pour diagnostiquer sur le site déployé :
`localStorage.setItem('bp.debug','1')` puis recharger.

---

## 6. Revenir en arrière

Chaque build publie aussi un tag court par commit (`sha-abc1234`). Pour revenir,
remplacer `:main` par ce tag dans `docker-compose.yml` et redéployer.

---

## 7. Ce qui n'a pas pu être vérifié localement

`docker build` n'a jamais tourné sur la machine de dev (démon Docker arrêté).
`pnpm build`, `pnpm install --frozen-lockfile`, les types et les tests passent.
Le premier passage du job `image` est donc le vrai test du Dockerfile.
