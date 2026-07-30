import type { EnrichedCard, Finish, ListDef, ListEntry } from '../types';

export const MAX_LIST_NAME = 60;

/**
 * True for a static list that catalogues owned cards rather than cards to
 * acquire. The single gate every acquisition surface (trade radar, cost to
 * complete, move-to-collection) checks — see ListDef.kind.
 */
export function isTrackingList(list: Pick<ListDef, 'kind'>): boolean {
  return list.kind === 'tracking';
}

export function clampListName(name: string): string {
  return name.trim().slice(0, MAX_LIST_NAME);
}

/** Ceiling for a typed target price — mirrors CardEditDialog's MAX_PAID. */
export const MAX_TARGET_PRICE = 1_000_000;

/**
 * Parse a typed `ListEntry.targetPrice`. Three outcomes:
 * - blank → `null` (caller clears the stored value back to absent)
 * - garbage or non-positive → `undefined` (reject; caller keeps the
 *   previous stored value, matching the "reject negatives and garbage"
 *   contract — unlike CardEditDialog's cost-basis field, an invalid edit
 *   here must NOT silently clear an existing target)
 * - otherwise → the value, cents-rounded and capped at MAX_TARGET_PRICE
 *
 * Tolerates pasted currency symbols and thousands separators.
 */
export function parseTargetPrice(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[$€,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.round(n * 100) / 100, MAX_TARGET_PRICE);
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
