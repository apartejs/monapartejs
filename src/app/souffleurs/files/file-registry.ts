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

  /** Bloc « Files available » — clés id/name/type dans CET ordre (normatif). */
  listForWire(): SouffleurFileRef[] {
    return [...files.values()].map(({ id, name, type }) => ({ id, name, type }));
  },

  clear(): void {
    files.clear();
    void Promise.resolve(store?.clear?.()).catch(() => undefined);
  },
};

export type FileRegistry = typeof fileRegistry;
