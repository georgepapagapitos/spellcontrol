import type { EnrichedCard, Finish, ListEntry, ListKind } from '../types';

export const MAX_LIST_NAME = 60;
export const LIST_KINDS: ListKind[] = ['wishlist', 'buylist', 'deck', 'trade'];

export function clampListName(name: string): string {
  return name.trim().slice(0, MAX_LIST_NAME);
}

function uuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Builds a ListEntry from a card-shaped object (an EnrichedCard, or a freshly
 * enriched Scryfall card). Pure; quantity floored at 1.
 */
export function makeListEntry(
  card: Pick<
    EnrichedCard,
    'name' | 'scryfallId' | 'setCode' | 'collectorNumber' | 'finish' | 'oracleId'
  >,
  quantity = 1
): ListEntry {
  return {
    id: uuid(),
    name: card.name,
    scryfallId: card.scryfallId,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    oracleId: card.oracleId,
    quantity: Math.max(1, Math.floor(quantity) || 1),
  };
}

/** Passive "you own N": match owned cards by oracleId, fallback to name. */
export function ownedCountForEntry(entry: ListEntry, owned: EnrichedCard[]): number {
  return owned.filter((c) =>
    entry.oracleId ? c.oracleId === entry.oracleId : c.name === entry.name
  ).length;
}

/**
 * Converts an entry into `quantity` real EnrichedCards (fresh copyIds) for
 * "move to collection". Built from the entry's stored printing identity —
 * price/image are left unset (0); the user can refresh prices afterward.
 * Cards land in Main (no subCollectionId).
 */
export function entryToCards(entry: ListEntry): EnrichedCard[] {
  const n = Math.max(1, Math.floor(entry.quantity) || 1);
  const foil = entry.finish !== ('nonfoil' as Finish);
  return Array.from({ length: n }, () => ({
    copyId: uuid(),
    name: entry.name,
    setCode: entry.setCode,
    setName: '',
    collectorNumber: entry.collectorNumber,
    rarity: '',
    scryfallId: entry.scryfallId,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'list',
    finish: entry.finish,
    foil,
    oracleId: entry.oracleId,
  }));
}
