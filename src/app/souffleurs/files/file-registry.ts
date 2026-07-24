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
    return entry;
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
  },
};

export type FileRegistry = typeof fileRegistry;
