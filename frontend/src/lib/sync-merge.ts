import type { BinderDef } from '../types';
import type { Deck } from '../store/decks';
import type { StoredCollection } from './local-cards';

const SYNC_META_KEY = 'spellcontrol-sync-meta';
const DIRTY_KEY = 'spellcontrol-sync-dirty';

export interface SyncMeta {
  version: number;
  binderIds: string[];
  deckIds: string[];
  collectionUploadedAt: number | null;
}

export function loadSyncMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY);
    return raw ? (JSON.parse(raw) as SyncMeta) : null;
  } catch {
    return null;
  }
}

export function saveSyncMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    /* storage full or unavailable */
  }
}

export function setDirty(): void {
  try {
    localStorage.setItem(DIRTY_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function clearDirty(): void {
  try {
    localStorage.removeItem(DIRTY_KEY);
  } catch {
    /* ignore */
  }
}

export function isDirty(): boolean {
  try {
    return localStorage.getItem(DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}

interface HasIdAndTimestamps {
  id: string;
  createdAt: number;
  updatedAt: number;
}

function mergeEntities<T extends HasIdAndTimestamps>(
  local: T[],
  remote: T[],
  knownIds: Set<string> | null
): T[] {
  const localById = new Map(local.map((e) => [e.id, e]));
  const remoteById = new Map(remote.map((e) => [e.id, e]));
  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);
  const merged: T[] = [];

  for (const id of allIds) {
    const loc = localById.get(id);
    const rem = remoteById.get(id);

    if (loc && rem) {
      merged.push(loc.updatedAt >= rem.updatedAt ? loc : rem);
    } else if (loc && !rem) {
      if (knownIds && knownIds.has(id)) {
        // Server had it last time we synced, now it's gone → deleted on server.
        // Drop it.
      } else {
        merged.push(loc);
      }
    } else if (!loc && rem) {
      if (knownIds && knownIds.has(id)) {
        // We knew about it and removed it locally → local deletion.
        // Don't resurrect.
      } else {
        merged.push(rem);
      }
    }
  }

  return merged;
}

export function mergeBinders(
  local: BinderDef[],
  remote: BinderDef[],
  meta: SyncMeta | null
): BinderDef[] {
  const knownIds = meta ? new Set(meta.binderIds) : null;
  const merged = mergeEntities(local, remote, knownIds);
  return merged.map((b, i) => ({ ...b, position: i }));
}

export function mergeDecks(local: Deck[], remote: Deck[], meta: SyncMeta | null): Deck[] {
  const knownIds = meta ? new Set(meta.deckIds) : null;
  return mergeEntities(local, remote, knownIds);
}

export function mergeCollection(
  local: StoredCollection | null,
  remote: StoredCollection | null
): StoredCollection | null {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;

  const localTime = local.uploadedAt ?? 0;
  const remoteTime = remote.uploadedAt ?? 0;
  return localTime >= remoteTime ? local : remote;
}

export function buildSyncMeta(
  version: number,
  binders: BinderDef[],
  decks: Deck[],
  collection: StoredCollection | null
): SyncMeta {
  return {
    version,
    binderIds: binders.map((b) => b.id),
    deckIds: decks.map((d) => d.id),
    collectionUploadedAt: collection?.uploadedAt ?? null,
  };
}
