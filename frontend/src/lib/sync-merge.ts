import type { Deck } from '../store/decks';
import type { BinderDef, EnrichedCard, ListDef } from '../types';
import type { GameRecord } from './game-state';
import type { StoredCollection } from './local-cards';
import type { SyncSnapshot } from './auth-api';

/**
 * Pure helpers for merging a local snapshot with a server snapshot during the
 * guest → existing-account promotion path. The collision dialog only fires
 * once per device-account pair (the first pull for that user), so this code
 * is not on any hot path.
 *
 * Strategy is "union, prefer-local on collision":
 *   - cards: union by copyId. Local and server copyIds are nanoid-grade
 *     unique, so a collision is virtually impossible — but if one happens,
 *     prefer the local row (richer enrichment, fresher pricedAt).
 *   - binders / decks / lists / games: union by id; same prefer-local rule.
 *   - Name collisions on binders/decks/lists are kept as-is. We don't rename
 *     because the user explicitly chose Merge — they expect to see two
 *     "Standard" binders if they had one on each side, and renaming would
 *     surprise them. Documenting this rather than guessing.
 *
 * No mutation of inputs. Returned arrays are fresh.
 */

export interface LocalSnapshot {
  collection: StoredCollection | null;
  binders: BinderDef[];
  decks: Deck[];
  games: GameRecord[];
}

export interface MergedSnapshot extends SyncSnapshot {
  collection: StoredCollection | null;
  binders: BinderDef[];
  decks: Deck[];
  games: GameRecord[];
}

function uniqueById<T extends { id: string }>(local: T[], server: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of local) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  for (const row of server) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function uniqueCardsByCopyId(local: EnrichedCard[], server: EnrichedCard[]): EnrichedCard[] {
  const seen = new Set<string>();
  const out: EnrichedCard[] = [];
  for (const card of local) {
    if (seen.has(card.copyId)) continue;
    seen.add(card.copyId);
    out.push(card);
  }
  for (const card of server) {
    if (seen.has(card.copyId)) continue;
    seen.add(card.copyId);
    out.push(card);
  }
  return out;
}

function mergeLists(local: ListDef[], server: ListDef[]): ListDef[] {
  return uniqueById(local, server);
}

function mergeCollection(
  local: StoredCollection | null,
  server: StoredCollection | null
): StoredCollection | null {
  if (!local && !server) return null;
  if (!local) return server;
  if (!server) return local;

  const mergedCards = uniqueCardsByCopyId(local.cards, server.cards);
  const mergedLists = mergeLists(local.lists ?? [], server.lists ?? []);

  // Stitch import history: keep both sets, de-dup by id. importHistory
  // entries are append-only, so user-visible order doesn't matter much.
  const mergedHistory = uniqueById(local.importHistory ?? [], server.importHistory ?? []);

  return {
    // Filename: prefer local — they just merged INTO this device's view.
    fileName: local.fileName || server.fileName,
    cards: mergedCards,
    scryfallHits: Math.max(local.scryfallHits ?? 0, server.scryfallHits ?? 0),
    scryfallMisses: Math.max(local.scryfallMisses ?? 0, server.scryfallMisses ?? 0),
    uploadedAt: Math.max(local.uploadedAt ?? 0, server.uploadedAt ?? 0) || Date.now(),
    importHistory: mergedHistory,
    lists: mergedLists,
  };
}

/**
 * Build a merged snapshot from a local and a server snapshot. Pure: the
 * inputs are not mutated. The returned snapshot carries the server's
 * `version`/`updatedAt` so a subsequent pushNow lands with the correct base.
 */
export function mergeSnapshots(local: LocalSnapshot, server: SyncSnapshot): MergedSnapshot {
  const serverCollection = (server.collection as StoredCollection | null) ?? null;
  const serverBinders = Array.isArray(server.binders) ? (server.binders as BinderDef[]) : [];
  const serverDecks = Array.isArray(server.decks) ? (server.decks as Deck[]) : [];
  const serverGames = Array.isArray(server.games) ? (server.games as GameRecord[]) : [];

  return {
    collection: mergeCollection(local.collection, serverCollection),
    binders: uniqueById(local.binders, serverBinders),
    decks: uniqueById(local.decks, serverDecks),
    games: uniqueById(local.games, serverGames),
    version: server.version,
    updatedAt: server.updatedAt,
  };
}

/**
 * Convenience: count the data sides for the collision dialog UI without
 * forcing it to know the merge internals.
 */
export interface SideCounts {
  cards: number;
  binders: number;
  decks: number;
  lists: number;
  games: number;
}

export function countLocal(local: LocalSnapshot): SideCounts {
  return {
    cards: local.collection?.cards.length ?? 0,
    binders: local.binders.length,
    decks: local.decks.length,
    lists: local.collection?.lists.length ?? 0,
    games: local.games.length,
  };
}

export function countServer(server: SyncSnapshot): SideCounts {
  const collection = (server.collection as StoredCollection | null) ?? null;
  return {
    cards: collection?.cards.length ?? 0,
    binders: Array.isArray(server.binders) ? server.binders.length : 0,
    decks: Array.isArray(server.decks) ? server.decks.length : 0,
    lists: collection?.lists.length ?? 0,
    games: Array.isArray(server.games) ? server.games.length : 0,
  };
}
