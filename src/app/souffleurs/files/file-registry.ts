/**
 * Registry of attached files — source of truth for `file_id`s.
 * CONTRACT RULE: the model only sees files via the "Files available"
 * `[{id,name,type}]` block of the system prompt, and copies the EXACT ids
 * (major v5 fix: without this block it invents the file_ids).
 * Training-identical id format: `file_<base36>_<n>` (e.g. file_mplct4ks_4).
 */
import type { SouffleurFileRef } from '../wire/system-prompt';

export interface RegisteredFile extends SouffleurFileRef {
  mime: string;
  blob: Blob;
  addedAt: number;
  /**
   * Owning conversation. `null` = attached before the conversation exists
   * (adopted when it's created); absent = row predating attachment,
   * never listed. See SouffleurFileRow.
   */
  convId?: string | null;
}

/** Extension → Files available block type (mapping of training's `_ext_type`). */
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
 * Persistence INJECTED (the souffleurs module doesn't know Dexie — same
 * pattern as setArtifactSink/setArtifactLoader). Without it, a reload would
 * empty the Map: the "Files available" block would come back empty and EVERY
 * `file_id` in the history would become "unknown" on the
 * read_file/write_file/transform_file side.
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
 * Resolver for the current conversation, INJECTED (the souffleurs module
 * knows neither Angular nor the conversation manager — same pattern as
 * setFileStore). It attaches each file to its thread.
 *
 * Without it, the registry was global: the "Files available" block announced
 * to the model every file ever attached, including in a fresh thread. The
 * model would then do exactly what it's asked — a read_file on an image the
 * user hadn't attached, vision tower attached and ten seconds of GPU for a
 * "hello".
 *
 * It returns an empty string as long as the conversation isn't created yet:
 * that's the "pending" state, resolved by adoptPending().
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
    console.warn('[souffleurs] could not persist the attached file', err),
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
   * Reloads the persisted files into the Map. Must be called AT BOOT, before
   * the first request builds the "Files available" block and before a tool
   * handler resolves a `file_id` (get() stays synchronous).
   */
  async hydrate(): Promise<number> {
    if (!store) return 0;
    try {
      const rows = await store.loadAll();
      for (const row of rows) {
        if (!files.has(row.id)) files.set(row.id, row);
      }
      // Persisted ids already carry a counter: restart ABOVE the max seen,
      // otherwise two files from the same millisecond could collide.
      const maxSeen = rows.reduce((max, row) => {
        const n = Number(row.id.split('_').pop());
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      counter = Math.max(counter, maxSeen);
      return rows.length;
    } catch (err) {
      console.warn('[souffleurs] could not rehydrate attached files', err);
      return 0;
    }
  },

  get(id: string): RegisteredFile | undefined {
    return files.get(id);
  },

  /**
   * "Files available" block — id/name/type keys in THIS order (normative).
   *
   * Restricted to the current conversation. In a thread that doesn't exist
   * yet, only pending files are listed: those the user just attached to the
   * message that's about to create this thread. A row predating attachment
   * (convId absent) is listed nowhere — it stays resolvable via get(), which
   * a `file_id` from the history needs.
   */
  listForWire(convId: string | null = currentConv()): SouffleurFileRef[] {
    const wanted = convId || null;
    return [...files.values()]
      .filter((entry) => (wanted === null ? entry.convId === null : entry.convId === wanted))
      .map(({ id, name, type }) => ({ id, name, type }));
  },

  /**
   * Attaches pending files to the conversation that just came into being.
   * An attachment is registered on send, so BEFORE the conversation has an
   * id: without this adoption it would stay pending and leak into the next
   * fresh thread. Returns the number of files adopted.
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

  /**
   * Forgets the files of a deleted conversation.
   *
   * The Map ONLY: the Dexie row already goes with the conversation, in the
   * same transaction as its messages and artifacts (conversationAdapter.delete).
   * Without this complement, the blobs stayed in memory until the next
   * reload — and a deleted file_id kept resolving.
   */
  dropConversation(convId: string): number {
    if (!convId) return 0;
    let dropped = 0;
    for (const [id, entry] of files) {
      if (entry.convId === convId) {
        files.delete(id);
        dropped++;
      }
    }
    return dropped;
  },

  clear(): void {
    files.clear();
    void Promise.resolve(store?.clear?.()).catch(() => undefined);
  },
};

export type FileRegistry = typeof fileRegistry;
