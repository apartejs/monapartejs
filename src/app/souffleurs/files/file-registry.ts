/**
 * Registre des fichiers joints — source de vérité des `file_id`.
 * RÈGLE CONTRAT : le modèle ne voit les fichiers QUE via le bloc
 * « Files available » `[{id,name,type}]` du prompt système, et copie les id
 * EXACTS (fix majeur v5 : sans ce bloc il invente les file_id).
 * Format d'id iso training : `file_<base36>_<n>` (ex. file_mplct4ks_4).
 */
import type { SouffleurFileRef } from '../wire/system-prompt';

export interface RegisteredFile extends SouffleurFileRef {
  mime: string;
  blob: Blob;
  addedAt: number;
  /**
   * Conversation proprietaire. `null` = joint avant que la conversation
   * n'existe (adopte a sa creation) ; absent = ligne d'avant le rattachement,
   * jamais listee. Voir SouffleurFileRow.
   */
  convId?: string | null;
}

/** Extension → type du bloc Files available (mapping `_ext_type` du training). */
export function extType(name: string, mime = ''): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['xlsx', 'xls'].includes(ext)) return 'xlsx';
  if (['docx', 'doc'].includes(ext)) return 'docx';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv') return 'csv';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext) || mime.startsWith('image/')) {
    return 'image';
  }
  if (['txt', 'md'].includes(ext) || mime.startsWith('text/')) return 'txt';
  return ext || 'file';
}

let counter = 0;

function genFileId(): string {
  counter++;
  return `file_${Date.now().toString(36)}_${counter}`;
}

const files = new Map<string, RegisteredFile>();

/**
 * Persistance INJECTÉE (le module souffleurs ne connaît pas Dexie — même
 * patron que setArtifactSink/setArtifactLoader). Sans elle, un reload vidait la
 * Map : le bloc « Files available » repartait vide et TOUT `file_id` de
 * l'historique devenait « inconnu » côté read_file/write_file/transform_file.
 */
export interface FileStore {
  put(entry: RegisteredFile): void | PromiseLike<unknown>;
  loadAll(): Promise<RegisteredFile[]>;
  remove?(id: string): void | PromiseLike<unknown>;
  clear?(): void | PromiseLike<unknown>;
}

let store: FileStore | null = null;

export function setFileStore(next: FileStore | null): void {
  store = next;
}

/**
 * Resolveur de la conversation courante, INJECTE (le module souffleurs ne
 * connait ni Angular ni le gestionnaire de conversations — meme patron que
 * setFileStore). Il rattache chaque fichier a son fil.
 *
 * Sans lui, le registre etait global : le bloc « Files available » annoncait au
 * modele tous les fichiers jamais joints, y compris dans un fil vierge. Le
 * modele faisait alors ce qu'on lui demande — un read_file sur une image que
 * l'utilisateur n'avait pas jointe, tour vision rattachee et dix secondes de
 * GPU pour un « bonjour ».
 *
 * Il retourne une chaine vide tant que la conversation n'est pas creee : c'est
 * l'etat « en attente », resolu par adoptPending().
 */
let resolveConv: (() => string | null) | null = null;

export function setConversationResolver(next: (() => string | null) | null): void {
  resolveConv = next;
}

function currentConv(): string | null {
  return resolveConv?.() || null;
}

function persist(entry: RegisteredFile): void {
  void Promise.resolve(store?.put(entry)).catch((err) =>
    console.warn('[souffleurs] persistance du fichier joint impossible', err),
  );
}

export const fileRegistry = {
  register(file: File): RegisteredFile {
    const entry: RegisteredFile = {
      id: genFileId(),
      name: file.name,
      type: extType(file.name, file.type),
      mime: file.type,
      blob: file,
      addedAt: Date.now(),
      convId: currentConv(),
    };
    files.set(entry.id, entry);
    persist(entry);
    return entry;
  },

  registerBlob(blob: Blob, name: string, mime: string): RegisteredFile {
    const entry: RegisteredFile = {
      id: genFileId(),
      name,
      type: extType(name, mime),
      mime,
      blob,
      addedAt: Date.now(),
      convId: currentConv(),
    };
    files.set(entry.id, entry);
    persist(entry);
    return entry;
  },

  /**
   * Recharge les fichiers persistés dans la Map. À appeler AU BOOT, avant que
   * la première requête ne construise le bloc « Files available » et avant
   * qu'un handler d'outil ne résolve un `file_id` (get() reste synchrone).
   */
  async hydrate(): Promise<number> {
    if (!store) return 0;
    try {
      const rows = await store.loadAll();
      for (const row of rows) {
        if (!files.has(row.id)) files.set(row.id, row);
      }
      // Les ids persistés portent déjà un compteur : repartir AU-DESSUS du max
      // vu, sinon deux fichiers de la même milliseconde peuvent collisionner.
      const maxSeen = rows.reduce((max, row) => {
        const n = Number(row.id.split('_').pop());
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      counter = Math.max(counter, maxSeen);
      return rows.length;
    } catch (err) {
      console.warn('[souffleurs] réhydratation des fichiers joints impossible', err);
      return 0;
    }
  },

  get(id: string): RegisteredFile | undefined {
    return files.get(id);
  },

  /**
   * Bloc « Files available » — cles id/name/type dans CET ordre (normatif).
   *
   * Restreint a la conversation courante. Dans un fil qui n'existe pas encore,
   * seuls les fichiers en attente sont listes : ce sont ceux que l'utilisateur
   * vient de joindre au message qui va creer ce fil. Une ligne d'avant le
   * rattachement (convId absent) n'est listee nulle part — elle reste
   * resoluble par get(), ce dont un file_id de l'historique a besoin.
   */
  listForWire(convId: string | null = currentConv()): SouffleurFileRef[] {
    const wanted = convId || null;
    return [...files.values()]
      .filter((entry) => (wanted === null ? entry.convId === null : entry.convId === wanted))
      .map(({ id, name, type }) => ({ id, name, type }));
  },

  /**
   * Rattache les fichiers en attente a la conversation qui vient de naitre.
   * Une piece jointe est enregistree a l'envoi, donc AVANT que la conversation
   * n'ait un id : sans cette adoption elle resterait en attente et fuirait dans
   * le prochain fil vierge. Retourne le nombre de fichiers adoptes.
   */
  adoptPending(convId: string): number {
    if (!convId) return 0;
    let adopted = 0;
    for (const entry of files.values()) {
      if (entry.convId === null) {
        entry.convId = convId;
        persist(entry);
        adopted++;
      }
    }
    return adopted;
  },

  clear(): void {
    files.clear();
    void Promise.resolve(store?.clear?.()).catch(() => undefined);
  },
};

export type FileRegistry = typeof fileRegistry;
