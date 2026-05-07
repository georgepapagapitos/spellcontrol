import type { BinderDef } from '../types';
import type { StoredCollection } from './local-cards';

/**
 * Versioned, self-describing backup of everything the app stores locally:
 * the imported collection (IndexedDB) plus binder definitions (localStorage).
 *
 * Versioning lets us evolve the schema without locking users out of older
 * backup files — bump `version` and add a migration path in `parseBackup`.
 */
export const BACKUP_FORMAT = 'mtg-binder-planner-backup';
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

export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `mtg-binder-planner-backup-${stamp}.json`;
}

export function downloadBackup(backup: Backup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
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
      "This doesn't look like an MTG Binder Planner backup file. Expected an export from this app."
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

  const binders = Array.isArray(obj.binders) ? (obj.binders as BinderDef[]) : [];
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
