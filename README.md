# monaparte

Un assistant conversationnel dont le modèle de langage s'exécute **entièrement
dans le navigateur**. Il n'y a pas de serveur d'inférence : la conversation, les
fichiers joints et les documents produits ne quittent pas l'appareil du
visiteur. Le serveur ne sert que des fichiers statiques.

En ligne : **[mon.apartejs.dev](https://mon.apartejs.dev)** · vitrine de
**[aparté](https://apartejs.dev)**, la bibliothèque d'interface de conversation.

---

## Démarrer

```bash
pnpm install
pnpm start        # http://localhost:4200
```

Node ≥ 22, pnpm 10 (fourni par corepack). Au premier lancement le navigateur
télécharge le modèle depuis Hugging Face ; comptez quelques minutes et gardez
l'onglet ouvert.

| Commande | Ce qu'elle fait |
|---|---|
| `pnpm verify` | types application + types **worker** + tests — ce que lance la CI |
| `pnpm test` | Vitest, sans navigateur |
| `pnpm build` | construction de production dans `dist/monaparte/browser` |
| `node tools/render-assets.mjs` | refabrique carte sociale et icônes depuis les SVG |

`typecheck` et `typecheck:worker` sont **deux** commandes, et ce n'est pas un
oubli : `tsc` ne suit pas un `new Worker(new URL(...))`, donc le worker
d'inférence n'est jamais vérifié par la passe de l'application. Sans la seconde,
une erreur de type y passe jusqu'en production.

---

## Comment ça tourne

Un modèle **unique** sert tout. Les spécialisations sont des adaptateurs LoRA
échangés à chaud à l'appel — les « souffleurs » —, et la compréhension d'image
est un encodeur séparé rattaché de la même façon, à la première image. C'est ce
qui permet de tenir en un seul téléchargement au lieu d'un modèle par usage.

```
navigateur
 ├── fil principal    interface aparté, outils, persistance Dexie
 └── worker           transformers.js sur WebGPU (repli WebAssembly)
                       ├── base partagée                        795 Mo
                       ├── 4 adaptateurs LoRA (86 Mo pièce)     344 Mo
                       └── tour vision, à la demande            269 Mo
```

Soit ~1,14 Go au premier lancement, ~1,4 Go si une image est analysée. Tout est
tiré de [`maxituc/aparte-souffleurs`](https://huggingface.co/maxituc/aparte-souffleurs)
et vit ensuite dans le Cache API du navigateur. Le chemin des fichiers est
résolu par le `manifest.json` du dépôt : publier de nouveaux poids ne demande
aucun changement de code.

Un souffleur appelle, trois exécutent : `souffleur-chat` mène la conversation et
décide des outils ; `souffleur-pdf`, `souffleur-xlsx-docx` et
`souffleur-sandbox` font le travail. Les outils disponibles sont la lecture d'un
fichier joint (image comprise), la production de xlsx/docx/pdf, la conversion
déterministe, le calcul exact en bac à sable, les artefacts (graphique, code,
HTML, SVG), les rappels locaux et la question de clarification.

### Deux exigences non négociables

**COOP et COEP.** Sans `Cross-Origin-Opener-Policy: same-origin` et
`Cross-Origin-Embedder-Policy: credentialless`, pas de `SharedArrayBuffer`, donc
pas de WebAssembly multi-thread, donc une inférence lente au point d'être
inutilisable — **et aucun message d'erreur**. Vérifiez `crossOriginIsolated ===
true` dans la console avant de chercher ailleurs.

**Un contexte sécurisé.** WebGPU et `SharedArrayBuffer` exigent HTTPS (ou
`localhost`).

---

## Le code

| Dossier | Ce qu'on y trouve |
|---|---|
| `src/app/souffleurs/` | tout ce qui touche au modèle : worker, manifeste, outils, vision, format du fil |
| `src/app/souffleurs/wire/` | prompt système, analyse des appels d'outil, démultiplexage du flux |
| `src/app/storage/` | Dexie : conversations, messages, pièces jointes, artefacts, fichiers |
| `src/app/core/` | configuration aparté, thème, i18n, statut du modèle |
| `src/app/features/`, `pages/` | interface : réglages, recherche, confidentialité, chat, mise au point |
| `docker/`, `.github/workflows/` | image de service et chaîne de déploiement |

Les commentaires du code et l'interface sont en **français**. Les textes
destinés au modèle — prompt système, descriptions d'outils — sont en **anglais
ou dans la langue du contrat d'entraînement**, et ne se traduisent pas : ce sont
des entrées de modèle, pas de la documentation.

### Mettre au point

Les traces du fil (prompt envoyé, sortie brute, appels analysés) sont actives
d'office en développement. Sur le site déployé elles sont muettes ; pour les
rallumer :

```js
localStorage.setItem('bp.debug', '1')   // puis recharger
```

`/debug/prompt` montre le dernier échange réel avec ses contrôles (liste des
outils présente, BOS unique, tour assistant ouvert, appel d'outil détecté).

---

## Déploiement

La construction tourne sur GitHub, jamais sur le serveur : une construction
Angular de production demande plusieurs Go de mémoire. Coolify ne fait que tirer
l'image publiée.

```
push sur main → GitHub Actions → ghcr.io/apartejs/monapartejs:main → webhook Coolify
```

Le détail, et surtout les pièges qui ont coûté une soirée chacun — un
healthcheck sur `localhost` en IPv6, une image jamais retéléchargée faute de
`pull_policy` — sont dans **[docs/DEPLOY-COOLIFY.md](docs/DEPLOY-COOLIFY.md)**.
À lire avant de toucher à la configuration devant un 503.

---

## État

Le modèle est petit et encore en apprentissage. Il montre ce qu'un assistant
sur l'appareil sait faire ; il ne rivalise pas avec un modèle hébergé. Ses
limites mesurées sont consignées au fil de l'usage et alimentent la prochaine
passe d'entraînement.
