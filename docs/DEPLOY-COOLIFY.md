# Déployer monaparte sur Coolify

L'app est **100 % statique** : nginx sert un bundle, et tout le modèle (base
834 Mo, adapters, tour vision 269 Mo) est téléchargé par le navigateur du
visiteur depuis Hugging Face et vit dans son Cache API. Le conteneur n'a donc
**aucun état, aucun volume, aucune variable d'environnement**, et son image pèse
quelques dizaines de Mo.

Conséquence à garder en tête : le serveur ne coûte presque rien, mais **le
premier chargement d'un visiteur tire ~1,1 Go depuis huggingface.co** (et non
depuis chez nous). Ce n'est pas notre bande passante, c'est celle de HF.

---

## 1. Créer la ressource

Dans le projet Coolify → **+ New** → **Application** → source **Git repository**
(GitHub app ou clé de déploiement selon ton accès).

| Réglage | Valeur | Pourquoi |
|---|---|---|
| Build Pack | **Dockerfile** | pas Nixpacks : on veut nos en-têtes nginx |
| Dockerfile Location | `docker/Dockerfile` | il n'est pas à la racine |
| Base Directory | `/` | le contexte de build est la racine du dépôt |
| Branch | la branche à servir | voir §5 |
| Port (Ports Exposes) | **80** | nginx écoute 80 dans l'image |
| Health check | activé | l'image en déclare un sur `/index.html` |

Rien d'autre : pas de variables, pas de volume, pas de commande de démarrage.

Le `Dockerfile` est **multi-étages** et construit le bundle dans l'image
(`node:24-alpine` → `pnpm build` → `nginx:alpine`). Il n'a besoin d'aucun
`dist/` préexistant. `.dockerignore` exclut `node_modules` — sans quoi le
`node_modules` de la machine de dev écraserait les dépendances Linux installées
dans l'image.

---

## 2. Domaine et HTTPS

Le sous-domaine est déjà redirigé depuis OVH vers l'IP de Coolify. Il reste à :

1. renseigner le FQDN complet dans **Domains**, avec le schéma :
   `https://mon-sous-domaine.exemple.fr` — le `https://` est ce qui déclenche la
   génération Let's Encrypt par Traefik ;
2. laisser Coolify émettre le certificat (quelques secondes) ;
3. vérifier que ça répond en HTTPS **avant** de tester l'app.

**HTTPS n'est pas optionnel ici** : WebGPU et `SharedArrayBuffer` exigent un
contexte sécurisé. En HTTP simple, le modèle ne se chargera pas — ou tombera en
wasm mono-thread, beaucoup plus lent, sans message clair.

---

## 3. Le point qui casse tout si on l'oublie : COOP/COEP

`docker/nginx.conf` émet sur **toutes** les réponses :

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Sans ces deux en-têtes, pas de `SharedArrayBuffer`, donc pas de wasm
multi-thread : l'inférence devient lente au point d'être inutilisable.

`credentialless` et non `require-corp`, délibérément : l'app charge en
cross-origin les poids depuis `huggingface.co` et le runtime wasm d'ONNX Runtime
depuis `cdn.jsdelivr.net`. `require-corp` exigerait un `Cross-Origin-Resource-Policy`
de leur part, qu'on ne contrôle pas.

⚠️ **Si Coolify/Traefik ajoute ou réécrit des en-têtes de sécurité**, vérifier
qu'il ne supprime pas ceux-là. Contrôle après déploiement :

```bash
curl -sI https://<domaine>/ | grep -i cross-origin
# doit afficher les deux lignes
```

Et dans la console du navigateur, `crossOriginIsolated` doit valoir `true`.

---

## 4. Ce qui a déjà été validé, et ce qui ne l'est pas

| | état |
|---|---|
| `pnpm build` en production | ✅ passe |
| lockfile en phase avec `package.json` (`--frozen-lockfile`) | ✅ vérifié |
| `docker build` | ⚠️ **non vérifié** — le démon Docker n'était pas démarré sur la machine de dev. Le premier build Coolify est donc le vrai test. |
| en-têtes COOP/COEP servis par nginx | ⚠️ à vérifier avec le `curl` ci-dessus |

Si le build Coolify échoue, regarder d'abord :
- l'étape `pnpm install --frozen-lockfile` (désynchronisation du lockfile) ;
- la mémoire disponible : un build Angular en production dépasse volontiers
  2 Go. Sur une petite instance, augmenter le swap ou builder ailleurs.

---

## 5. Branche servie

Le travail est sur `feat/vision-encoder-et-deploiement`. Deux options :

- **pointer Coolify sur cette branche** pour un premier essai sans toucher à
  `main` ;
- **fusionner dans `main`** puis pointer Coolify sur `main`.

Le déploiement automatique au push est à activer une fois qu'un build a réussi,
pas avant.

---

## 6. Après le premier déploiement — ordre de vérification

1. `curl -sI https://<domaine>/ | grep -i cross-origin` → les deux en-têtes.
2. Ouvrir l'app : l'onboarding doit annoncer le téléchargement, **tour vision
   comprise** (le total est lu du `manifest.json` de HF).
3. Laisser descendre le modèle, envoyer un message.
4. Joindre une image et demander ce qu'elle contient : la carte `read_file` doit
   afficher une description, pas une erreur.
5. Recharger la page : l'image doit toujours être là et le fil intact.
6. `/debug/prompt` doit montrer le dernier échange, avec le bloc
   `List of tools`.

Les traces console sont **silencieuses en production** (elles suivent
`isDevMode()`). Pour diagnostiquer sur le site déployé :
`localStorage.setItem('bp.debug','1')` puis recharger.
