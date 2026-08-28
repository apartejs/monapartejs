/** Traductions app (les chaînes des composants aparte viennent de la lib). */

export interface Translations {
  brand: string;
  topbar: {
    toggleSidebar: string;
    localBadge: string;
    themeToggle: string;
  };
  sidebar: {
    newChat: string;
    search: string;
    today: string;
    yesterday: string;
    earlier: string;
    archived: string;
    archive: string;
    unarchive: string;
    delete: string;
    deleteConfirm: string;
    settings: string;
    empty: string;
  };
  welcome: {
    greetings: { night: string; morning: string; afternoon: string; evening: string };
    tagline: string;
    sub: string;
  };
  chat: {
    placeholder: string;
    helper: string;
  };
  modelStatus: {
    ready: string;
    downloading: string;
    loading: string;
    generating: string;
    error: string;
    notDownloaded: string;
    unknown: string;
  };
  settings: {
    title: string;
    theme: { label: string; light: string; dark: string };
    language: { label: string };
    sendOnEnter: { label: string; sub: string };
    model: { label: string; redownload: string; deleteData: string };
    data: {
      label: string;
      exportBtn: string;
      importBtn: string;
      clearBtn: string;
      clearConfirm: string;
      imported: string;
      importError: string;
    };
    close: string;
  };
  privacy: {
    title: string;
    body: string[];
    close: string;
  };
  onboarding: {
    intro: {
      tag: string;
      title: string;
      body: string;
      bullets: { label: string; sub: string }[];
      next: string;
    };
    download: {
      tag: string;
      title: string;
      body: string;
      meta: string;
      start: string;
      back: string;
    };
    ready: {
      tag: string;
      titleDownloading: string;
      titleReady: string;
      body: string;
      error: string;
      retry: string;
      start: string;
    };
  };
  modelUpdate: {
    title: string;
    body: string;
    action: string;
    error: string;
    retry: string;
  };
  stats: {
    title: string;
    device: string;
    tokens: string;
    ttft: string;
    speed: string;
    duration: string;
  };
  update: { available: string; reload: string };
  search: { placeholder: string; noResults: string; hint: string };
  linkGuard: { title: string; body: string; open: string };
  context: { label: string; tooltip: string };
  common: { cancel: string; confirm: string };
}

export const FR: Translations = {
  brand: 'aparté',
  topbar: {
    toggleSidebar: 'Ouvrir/fermer le panneau',
    localBadge: '100 % local',
    themeToggle: 'Basculer clair/sombre',
  },
  sidebar: {
    newChat: 'Nouvelle conversation',
    search: 'Rechercher',
    today: "Aujourd'hui",
    yesterday: 'Hier',
    earlier: 'Plus tôt',
    archived: 'Archivées',
    archive: 'Archiver',
    unarchive: 'Désarchiver',
    delete: 'Supprimer',
    deleteConfirm: 'Supprimer définitivement cette conversation ?',
    settings: 'Paramètres',
    empty: 'Aucune conversation pour l’instant.',
  },
  welcome: {
    greetings: {
      night: 'Bonsoir',
      morning: 'Bonjour',
      afternoon: 'Bonjour',
      evening: 'Bonsoir',
    },
    tagline: 'Un mot en aparté ?',
    sub: 'Tout se passe ici, dans votre navigateur. Rien ne sort de votre appareil.',
  },
  chat: {
    placeholder: 'Dites quelque chose…',
    helper: 'Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne · 100 % local',
  },
  modelStatus: {
    ready: 'prêt',
    downloading: 'téléchargement…',
    loading: 'chargement…',
    generating: 'en train d’écrire…',
    error: 'erreur',
    notDownloaded: 'non téléchargé',
    unknown: '—',
  },
  settings: {
    title: 'Paramètres',
    theme: { label: 'Thème', light: 'Clair', dark: 'Sombre' },
    language: { label: 'Langue' },
    sendOnEnter: {
      label: 'Envoyer avec Entrée',
      sub: 'Désactivé : Entrée fait une nouvelle ligne, Ctrl+Entrée envoie.',
    },
    model: {
      label: 'Modèle local',
      redownload: 'Retélécharger',
      deleteData: 'Supprimer les poids téléchargés',
    },
    data: {
      label: 'Vos données',
      exportBtn: 'Exporter (JSON)',
      importBtn: 'Importer…',
      clearBtn: 'Tout effacer',
      clearConfirm:
        'Effacer toutes les conversations, la mémoire et les préférences de cet appareil ?',
      imported: 'Import terminé — rechargement…',
      importError: 'Fichier d’import invalide.',
    },
    close: 'Fermer',
  },
  privacy: {
    title: 'Confidentialité',
    body: [
      'aparté tourne entièrement dans votre navigateur : le modèle est téléchargé une fois, puis tout — conversations, réglages, inférence — reste sur votre appareil.',
      'Aucun compte, aucun cookie, aucune requête vers un serveur pendant vos conversations. Coupez internet : aparté continue de fonctionner.',
      'Vos conversations ne nourrissent aucun modèle. Elles vous appartiennent : exportez-les ou effacez-les à tout moment depuis les paramètres.',
    ],
    close: 'Fermer',
  },
  onboarding: {
    intro: {
      tag: 'Local-first',
      title: 'Une IA qui reste chez vous.',
      body: 'aparté tourne dans votre navigateur, pas dans le cloud. Pas de compte, pas de tracking, pas d’entraînement sur vos données.',
      bullets: [
        { label: 'Vos mots restent ici', sub: 'Aucune requête, aucune copie côté serveur.' },
        { label: 'Aucun entraînement', sub: 'Vos conversations ne nourrissent aucun modèle.' },
        { label: 'Aucun compte', sub: 'Pas d’email, pas de cookies, pas de profil.' },
      ],
      next: 'Continuer',
    },
    download: {
      tag: 'Téléchargement',
      title: 'Une seule fois : {size} à télécharger.',
      body: 'Le souffleur d’aparté — un modèle open-source qui vivra dans le cache de votre navigateur. Une fois téléchargé, vous pouvez couper internet : aparté continue de fonctionner.',
      meta: 'Source : Hugging Face · Stockage : cache du navigateur · Durée : quelques minutes selon votre connexion',
      start: 'Télécharger et commencer',
      back: 'Retour',
    },
    ready: {
      tag: 'Préparation',
      titleDownloading: 'Le souffleur arrive…',
      titleReady: 'Tout est prêt.',
      body: 'Le modèle est installé. Vos conversations commencent maintenant — en privé.',
      error: 'Le téléchargement a échoué. Vérifiez votre connexion, puis réessayez.',
      retry: 'Réessayer',
      start: 'Commencer',
    },
  },
  modelUpdate: {
    title: 'Le souffleur a été mis à jour',
    body: 'Une nouvelle version du modèle est disponible. Le téléchargement remplace l’ancienne dans le cache du navigateur — vos conversations ne bougent pas.',
    action: 'Mettre à jour ({size})',
    error: 'La mise à jour a échoué. Vérifiez votre connexion, puis réessayez.',
    retry: 'Réessayer',
  },
  stats: {
    title: 'Génération',
    device: 'Matériel',
    tokens: 'Tokens',
    ttft: 'Premier token',
    speed: 'Vitesse',
    duration: 'Durée',
  },
  update: {
    available: 'Une nouvelle version d’aparté est disponible.',
    reload: 'Mettre à jour',
  },
  search: {
    placeholder: 'Rechercher dans les conversations…',
    noResults: 'Aucun résultat.',
    hint: '↑↓ naviguer · Entrée ouvrir · Échap fermer',
  },
  linkGuard: {
    title: 'Ouvrir un lien externe ?',
    body: 'Ce lien vient d’une réponse générée. Vérifiez l’adresse avant d’ouvrir :',
    open: 'Ouvrir',
  },
  context: {
    label: 'contexte',
    tooltip:
      'Estimation de la place occupée dans la fenêtre de contexte du modèle (≈ 4096 tokens).',
  },
  common: { cancel: 'Annuler', confirm: 'Confirmer' },
};

export const EN: Translations = {
  brand: 'aparté',
  topbar: {
    toggleSidebar: 'Toggle sidebar',
    localBadge: '100% local',
    themeToggle: 'Toggle light/dark',
  },
  sidebar: {
    newChat: 'New conversation',
    search: 'Search',
    today: 'Today',
    yesterday: 'Yesterday',
    earlier: 'Earlier',
    archived: 'Archived',
    archive: 'Archive',
    unarchive: 'Unarchive',
    delete: 'Delete',
    deleteConfirm: 'Permanently delete this conversation?',
    settings: 'Settings',
    empty: 'No conversations yet.',
  },
  welcome: {
    greetings: {
      night: 'Good evening',
      morning: 'Good morning',
      afternoon: 'Hello',
      evening: 'Good evening',
    },
    tagline: 'A private word?',
    sub: 'Everything happens here, in your browser. Nothing leaves your device.',
  },
  chat: {
    placeholder: 'Say something…',
    helper: 'Enter to send · Shift+Enter for a new line · 100% local',
  },
  modelStatus: {
    ready: 'ready',
    downloading: 'downloading…',
    loading: 'loading…',
    generating: 'writing…',
    error: 'error',
    notDownloaded: 'not downloaded',
    unknown: '—',
  },
  settings: {
    title: 'Settings',
    theme: { label: 'Theme', light: 'Light', dark: 'Dark' },
    language: { label: 'Language' },
    sendOnEnter: {
      label: 'Send with Enter',
      sub: 'Off: Enter inserts a new line, Ctrl+Enter sends.',
    },
    model: {
      label: 'Local model',
      redownload: 'Re-download',
      deleteData: 'Delete downloaded weights',
    },
    data: {
      label: 'Your data',
      exportBtn: 'Export (JSON)',
      importBtn: 'Import…',
      clearBtn: 'Erase everything',
      clearConfirm: 'Erase all conversations, memory and preferences from this device?',
      imported: 'Import complete — reloading…',
      importError: 'Invalid import file.',
    },
    close: 'Close',
  },
  privacy: {
    title: 'Privacy',
    body: [
      'aparté runs entirely in your browser: the model is downloaded once, then everything — conversations, settings, inference — stays on your device.',
      'No account, no cookies, no server requests during your conversations. Cut the internet: aparté keeps working.',
      'Your conversations never feed a model. They are yours: export or erase them anytime from settings.',
    ],
    close: 'Close',
  },
  onboarding: {
    intro: {
      tag: 'Local-first',
      title: 'An AI that stays home.',
      body: 'aparté runs in your browser, not in the cloud. No account, no tracking, no training on your data.',
      bullets: [
        { label: 'Your words stay here', sub: 'No requests, no server-side copy.' },
        { label: 'No training', sub: 'Your conversations never feed a model.' },
        { label: 'No account', sub: 'No email, no cookies, no profile.' },
      ],
      next: 'Continue',
    },
    download: {
      tag: 'Download',
      title: 'One time only: {size} to download.',
      body: 'aparté’s souffleur — an open-source model that will live in your browser cache. Once downloaded, you can go offline: aparté keeps working.',
      meta: 'Source: Hugging Face · Storage: browser cache · Time: a few minutes depending on your connection',
      start: 'Download and start',
      back: 'Back',
    },
    ready: {
      tag: 'Preparing',
      titleDownloading: 'The souffleur is coming…',
      titleReady: 'All set.',
      body: 'The model is installed. Your conversations start now — privately.',
      error: 'The download failed. Check your connection and try again.',
      retry: 'Retry',
      start: 'Start',
    },
  },
  modelUpdate: {
    title: 'The souffleur was updated',
    body: 'A new model version is available. The download replaces the old one in your browser cache — your conversations stay put.',
    action: 'Update ({size})',
    error: 'The update failed. Check your connection and try again.',
    retry: 'Retry',
  },
  stats: {
    title: 'Generation',
    device: 'Hardware',
    tokens: 'Tokens',
    ttft: 'First token',
    speed: 'Speed',
    duration: 'Duration',
  },
  update: {
    available: 'A new version of aparté is available.',
    reload: 'Update',
  },
  search: {
    placeholder: 'Search conversations…',
    noResults: 'No results.',
    hint: '↑↓ navigate · Enter open · Esc close',
  },
  linkGuard: {
    title: 'Open external link?',
    body: 'This link comes from a generated reply. Check the address before opening:',
    open: 'Open',
  },
  context: {
    label: 'context',
    tooltip: 'Estimated share of the model context window (≈ 4096 tokens).',
  },
  common: { cancel: 'Cancel', confirm: 'Confirm' },
};
