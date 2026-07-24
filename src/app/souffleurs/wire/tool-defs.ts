/**
 * Contrat outils aparté v3.0.0-draft.1 + prompt système sp-chat 1.0.0.
 * PORTÉ VERBATIM du contrat d'entraînement des souffleurs — NE PAS reformuler :
 * le modèle est entraîné sur ces textes exacts (descriptions comprises).
 * Ordre des clés (name, description, parameters) et contenu = normatifs.
 */

export interface SouffleurToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const ASSISTANT_NAME = "l'assistant";

export const SP_CORE_TEMPLATE =
  "Tu es {{assistant}}, un assistant personnel qui tourne entièrement sur l'appareil de l'utilisateur — rien ne quitte cet appareil.\n\n- Réponds dans la langue de l'utilisateur, avec des réponses courtes et directes.\n- Des outils te sont fournis séparément : utilise-les quand ils correspondent à la demande, jamais quand tu peux répondre directement.\n- Ne calcule jamais un résultat non trivial de tête — utilise l'outil de calcul fourni.\n- Si une information factuelle n'est pas dans le contexte ou tes connaissances sûres : dis-le honnêtement. Tu es local — c'est aussi ce qui garantit la confidentialité.";

export const SOUFFLEUR_TOOL_DEFS: readonly SouffleurToolDef[] = [
  {
    "name": "read_file",
    "description": "Lit ou interroge un fichier DÉJÀ joint. Sans query: survol déterministe (structure, colonnes, type, métadonnées, aperçu). Avec query: question ciblée sur le contenu. USE pour: obtenir une info d'un fichier joint, confirmer qu'un fichier est attaché. DON'T USE: (1) si AUCUN fichier n'est joint → n'invente JAMAIS de file_id, demande via ask_question de quel fichier il s'agit ; (2) créer/modifier (write_file). NOTE kernel: le chemin (walker/sub-modèle/vision) est choisi par les coulisses.",
    "parameters": {
      "type": "object",
      "required": [
        "file_id"
      ],
      "properties": {
        "file_id": {
          "type": "string",
          "description": "L'id EXACT tel que listé dans le bloc « Files available » du contexte. Copie-le, ne le déduis pas du nom de fichier et ne l'invente JAMAIS. Aucun fichier listé → ask_question."
        },
        "query": {
          "type": "string"
        }
      }
    }
  },
  {
    "name": "write_file",
    "description": "Crée ou modifie un fichier téléchargeable (xlsx/docx/pdf). file_ids absent = création ; 1 id = édition ; n ids (pdf) = composition. USE pour: produire un document bureautique. DON'T USE: lire (read_file), convertir sans changer le contenu (transform_file), artefact affiché non-fichier (create_widget).",
    "parameters": {
      "type": "object",
      "required": [
        "kind",
        "task"
      ],
      "properties": {
        "kind": {
          "enum": [
            "xlsx",
            "docx",
            "pdf"
          ]
        },
        "task": {
          "type": "string",
          "description": "intention en langage naturel — le rôle artifact génère les ops sous grammaire RÈGLE données: cosmétique non fournie (titre, libellé) → placeholder [X] ; critique non fournie (destinataire, montant, date) → ne complète pas, l'assistant demandera. N'invente JAMAIS nom propre/montant/date."
        },
        "file_ids": {
          "type": "array",
          "description": "Pour l'ÉDITION : les id EXACTS du bloc « Files available ». Copie-les, ne les invente jamais. Absent = création.",
          "items": {
            "type": "string"
          }
        },
        "name": {
          "type": "string"
        }
      }
    }
  },
  {
    "name": "create_widget",
    "description": "Crée un artefact non-fichier affiché dans la conversation. kind: chart (données chiffrées), code (extrait/fonction), html (composant interactif/mini-page), svg (schéma vectoriel). USE pour: visualisation, snippet de code, HTML interactif, schéma demandés. DON'T USE: fichier téléchargeable (write_file), calcul dont seul le résultat importe (compute).",
    "parameters": {
      "type": "object",
      "required": [
        "kind",
        "task"
      ],
      "properties": {
        "kind": {
          "enum": [
            "html",
            "svg",
            "chart",
            "code"
          ]
        },
        "task": {
          "type": "string",
          "description": "intention en langage naturel RÈGLE données: cosmétique non fournie (titre, libellé) → placeholder [X] ; critique non fournie (destinataire, montant, date) → ne complète pas, l'assistant demandera. N'invente JAMAIS nom propre/montant/date."
        }
      }
    }
  },
  {
    "name": "compute",
    "description": "Exécute un calcul EXACT en sandbox (arithmétique, dates, unités, stats simples, regex). Le résultat alimente ta réponse (l'utilisateur ne voit pas le code). USE pour: TOUT calcul, MÊME apparemment simple — multiplication (847×293), pourcentage (12% de 8450), différence de dates (jours entre deux dates), somme, conversion d'unités. Ne calcule JAMAIS de tête, même si ça paraît facile (tu te trompes). DON'T USE: create_widget/code n'est PAS pour calculer un résultat (c'est pour un artefact code visible) ; write_file (fichier).",
    "parameters": {
      "type": "object",
      "required": [
        "task"
      ],
      "properties": {
        "task": {
          "type": "string"
        }
      }
    }
  },
  {
    "name": "transform_file",
    "description": "Transformation DÉTERMINISTE d'un fichier joint, sans IA: conversion de format, merge/split PDF, resize/compression d'image. USE pour: convertis/compresse/redimensionne/fusionne un fichier joint. DON'T USE: (1) modifier le CONTENU (write_file) ; (2) si aucun fichier joint → demande le fichier via ask_question, n'invente pas de file_id.",
    "parameters": {
      "type": "object",
      "required": [
        "file_id",
        "target"
      ],
      "properties": {
        "file_id": {
          "type": "string",
          "description": "L'id EXACT du bloc « Files available ». Copie-le, ne l'invente jamais. Aucun fichier listé → ask_question."
        },
        "target": {
          "enum": [
            "csv",
            "xlsx",
            "pdf",
            "docx",
            "png",
            "jpg",
            "webp",
            "merge",
            "split"
          ]
        },
        "options": {
          "type": "object"
        }
      }
    }
  },
  {
    "name": "search_knowledge",
    "description": "Recherche dans les connaissances LOCALES (mémoire, historique, docs indexés, packs). USE pour: question factuelle potentiellement dans le corpus local, rappel d'un échange passé. DON'T USE: contenu d'un fichier précis joint (read_file). Hors corpus: réponds honnêtement que tu ne sais pas (tu es 100% local).",
    "parameters": {
      "type": "object",
      "required": [
        "query"
      ],
      "properties": {
        "query": {
          "type": "string"
        },
        "scope": {
          "enum": [
            "memory",
            "history",
            "docs",
            "packs",
            "all"
          ]
        }
      }
    }
  },
  {
    "name": "remember",
    "description": "Enregistre un fait durable sur l'utilisateur (préférence, contexte, projet) en mémoire locale. Le rappel est automatique (pas de tool de lecture). USE pour: info explicitement donnée qui resservira. DON'T USE: détail éphémère.",
    "parameters": {
      "type": "object",
      "required": [
        "fact"
      ],
      "properties": {
        "fact": {
          "type": "string"
        }
      }
    }
  },
  {
    "name": "set_reminder",
    "description": "Programme un rappel local daté. USE pour: demande explicite de rappel/alarme avec une échéance. DON'T USE: (1) si la date/heure OU l'objet manque → demande via ask_question, n'invente pas de date ; (2) événement à exporter en fichier (write_file).",
    "parameters": {
      "type": "object",
      "required": [
        "when",
        "message"
      ],
      "properties": {
        "when": {
          "type": "string",
          "description": "ISO 8601 ou expression relative résolue par compute"
        },
        "message": {
          "type": "string"
        }
      }
    }
  },
  {
    "name": "ask_question",
    "description": "Pose 1 à 5 questions de clarification (options, multi-select, réponse libre). USE pour: référent absent/inconnu (fichier non joint, « ça »/« le document habituel » sans contexte), donnée critique manquante non devinable (destinataire, montant, date d'un rappel), désambiguïsation, demande genuinement ambiguë. Mieux vaut demander qu'inventer un référent. DON'T USE: demande claire avec défaut évident, donnée COSMÉTIQUE manquante (utilise un placeholder [X]), ou pour faire choisir une route interne.",
    "parameters": {
      "type": "object",
      "required": [
        "questions"
      ],
      "properties": {
        "questions": {
          "type": "array",
          "minItems": 1,
          "maxItems": 5,
          "items": {
            "type": "object",
            "required": [
              "question"
            ],
            "properties": {
              "question": {
                "type": "string"
              },
              "options": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "multi_select": {
                "type": "boolean"
              },
              "allow_other": {
                "type": "boolean"
              }
            }
          }
        }
      }
    }
  }
];

export const SOUFFLEUR_TOOL_NAMES = SOUFFLEUR_TOOL_DEFS.map((t) => t.name);
