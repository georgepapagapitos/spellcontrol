import type { BinderDef, EnrichedCard, SortEntry } from '../types';
import type { StoredCollection } from './local-cards';

/**
 * Converts a raw sorts value from any version of persisted data into the
 * current SortEntry[] format. Handles both old string[] and new object[].
 */
export function normalizeSortEntries(raw: unknown): SortEntry[] {
  if (!Array.isArray(raw)) return [{ field: 'color', dir: 'asc' }];
  return raw.map((item) => {
    if (item && typeof item === 'object' && 'field' in item) {
      return item as SortEntry;
    }
    const field = String(item);
    return { field, dir: field === 'price' ? 'desc' : 'asc' } as SortEntry;
  });
}

/**
 * Versioned, self-describing backup of everything the app stores locally:
 * the imported collection (IndexedDB) plus binder definitions (localStorage).
 *
 * Versioning lets us evolve the schema without locking users out of older
 * backup files — bump `version` and add a migration path in `parseBackup`.
 */
export const BACKUP_FORMAT = 'spellcontrol-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  collection: StoredCollection | null;
  binders: BinderDef[];
}

export function buildBackup(collection: StoredCollection | null, binders: BinderDef[]): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    collection,
    binders,
  };
}

/**
 * Backup containing a single binder definition and only the cards routed to it.
 * Restoring this overlays one binder onto a collection.
 */
export function buildBinderBackup(binder: BinderDef, binderCards: EnrichedCard[]): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    collection: cardsAsCollection(binderCards, `binder-${binder.name}`),
    binders: [binder],
  };
}

/**
 * Backup containing every binder definition and every card routed to any binder.
 * Cards that don't match any binder ("Uncategorized") are not included.
 */
export function buildAllBindersBackup(binders: BinderDef[], binderCards: EnrichedCard[]): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    collection: cardsAsCollection(binderCards, 'all-binders'),
    binders,
  };
}

function cardsAsCollection(cards: EnrichedCard[], label: string): StoredCollection {
  return {
    fileName: label,
    cards,
    scryfallHits: cards.length,
    scryfallMisses: 0,
    uploadedAt: Date.now(),
    importHistory: [
      {
        id: crypto.randomUUID(),
        name: label,
        count: cards.length,
        format: 'export',
        addedAt: Date.now(),
      },
    ],
    lists: [],
  };
}

function timestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Sanitize a binder name for use in a filename. Spaces → '-', drop everything else. */
function safeName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/^-+|-+$/g, '') || 'binder'
  );
}

export function backupFileName(now: Date = new Date()): string {
  return `spellcontrol-backup-${timestamp(now)}.json`;
}

export function binderBackupFileName(binderName: string, now: Date = new Date()): string {
  return `spellcontrol-binder-${safeName(binderName)}-${timestamp(now)}.json`;
}

export function allBindersBackupFileName(now: Date = new Date()): string {
  return `spellcontrol-binders-all-${timestamp(now)}.json`;
}

export function downloadBackup(backup: Backup, fileName?: string): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName ?? backupFileName();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the click handler has a frame to actually start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Parses and validates a backup payload. Throws a user-readable Error on
 * any structural problem so the caller can surface it directly.
 */
export function parseBackup(raw: string): Backup {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }

  if (!json || typeof json !== 'object') {
    throw new Error('Backup file is empty or malformed.');
  }
  const obj = json as Record<string, unknown>;

  if (obj.format !== BACKUP_FORMAT) {
    throw new Error(
      "This doesn't look like a SpellControl backup file. Expected an export from this app."
    );
  }
  if (typeof obj.version !== 'number') {
    throw new Error('Backup is missing a version number.');
  }
  if (obj.version > BACKUP_VERSION) {
    throw new Error(
      `Backup was made with a newer version of the app (v${obj.version}). Update the app and try again.`
    );
  }

  const binders = Array.isArray(obj.binders)
    ? (obj.binders as Array<Record<string, unknown>>).map(
        (b) => ({ ...b, sorts: normalizeSortEntries(b.sorts) }) as BinderDef
      )
    : [];
  const collection =
    obj.collection && typeof obj.collection === 'object'
      ? (obj.collection as StoredCollection)
      : null;

  if (collection && !Array.isArray(collection.cards)) {
    throw new Error('Backup collection is malformed (cards is not a list).');
  }

  return {
    format: BACKUP_FORMAT,
    version: obj.version,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
    collection,
    binders,
  };
}
