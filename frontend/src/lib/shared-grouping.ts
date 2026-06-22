import type { PublicCard } from './shared-types';
import { normalizeForSearch } from './normalize-search';

/**
 * Pure helpers for the shared-view components. PublicCard is a per-physical-
 * copy shape (each owned copy is its own object) — these helpers group / sort
 * / filter so the view can render stacks instead of one tile per copy.
 *
 * Kept store-agnostic on purpose: shared views must not touch zustand stores
 * (see SharedView page for the sync-invariant rationale).
 */

export interface GroupedCard {
  /** Stable key per printing+finish (scryfallId + finish). */
  key: string;
  /** Representative card (first copy in the input). All fields except per-copy
   *  flags are the same across copies of the same printing+finish. */
  card: PublicCard;
  /** Number of copies of this printing+finish the owner has. */
  quantity: number;
}

export function groupingKey(c: PublicCard): string {
  return `${c.scryfallId}::${c.finish}`;
}

export function groupCards(cards: PublicCard[]): GroupedCard[] {
  const buckets = new Map<string, GroupedCard>();
  for (const card of cards) {
    const key = groupingKey(card);
    const existing = buckets.get(key);
    if (existing) {
      existing.quantity += 1;
    } else {
      buckets.set(key, { key, card, quantity: 1 });
    }
  }
  return Array.from(buckets.values());
}

export type SharedSortKey = 'name' | 'cmc' | 'price' | 'set' | 'rarity' | 'qty';
export type SortDir = 'asc' | 'desc';

const RARITY_ORDER: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
};

function rarityRank(r: string): number {
  return RARITY_ORDER[r.toLowerCase()] ?? 99;
}

export function sortGrouped(
  grouped: GroupedCard[],
  field: SharedSortKey,
  dir: SortDir
): GroupedCard[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...grouped].sort((a, b) => {
    let diff = 0;
    switch (field) {
      case 'name':
        diff = a.card.name.localeCompare(b.card.name);
        break;
      case 'cmc':
        diff = (a.card.cmc ?? 0) - (b.card.cmc ?? 0);
        break;
      case 'price':
        diff = a.card.purchasePrice - b.card.purchasePrice;
        break;
      case 'set':
        diff = a.card.setCode.localeCompare(b.card.setCode);
        break;
      case 'rarity':
        diff = rarityRank(a.card.rarity) - rarityRank(b.card.rarity);
        break;
      case 'qty':
        diff = a.quantity - b.quantity;
        break;
    }
    // Stable tie-break by name then setCode/collectorNumber so the order is
    // deterministic across renders (avoids List rendering shuffle on rerender).
    if (diff === 0) diff = a.card.name.localeCompare(b.card.name);
    if (diff === 0) diff = a.card.setCode.localeCompare(b.card.setCode);
    if (diff === 0) diff = a.card.collectorNumber.localeCompare(b.card.collectorNumber);
    return diff * sign;
  });
}

export function filterBySearch(grouped: GroupedCard[], query: string): GroupedCard[] {
  const nq = normalizeForSearch(query);
  if (!nq) return grouped;
  return grouped.filter((g) => normalizeForSearch(g.card.name).includes(nq));
}

/**
 * Color filter: a card matches if at least one of the requested color codes
 * is in its color identity. Empty `colors` set means no filter. 'C' represents
 * colorless (empty colorIdentity).
 */
export function filterByColors(grouped: GroupedCard[], colors: ReadonlySet<string>): GroupedCard[] {
  if (colors.size === 0) return grouped;
  return grouped.filter((g) => {
    const ci = g.card.colorIdentity ?? [];
    if (colors.has('C') && ci.length === 0) return true;
    return ci.some((c) => colors.has(c));
  });
}

/**
 * Card-type bucket key for grouping a decklist. Uses the first major type
 * found in `typeLine`. Order matches a reader-friendly decklist layout.
 */
export type DeckBucketKey =
  | 'Creature'
  | 'Planeswalker'
  | 'Battle'
  | 'Instant'
  | 'Sorcery'
  | 'Enchantment'
  | 'Artifact'
  | 'Land'
  | 'Other';

export const DECK_BUCKET_ORDER: DeckBucketKey[] = [
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Enchantment',
  'Artifact',
  'Land',
  'Other',
];

export function deckBucketFor(typeLine: string | undefined): DeckBucketKey {
  const t = (typeLine ?? '').toLowerCase();
  // Land is grouped first because "Artifact Land" / "Enchantment Land" should
  // still go to the Land bucket.
  if (t.includes('land')) return 'Land';
  if (t.includes('creature')) return 'Creature';
  if (t.includes('planeswalker')) return 'Planeswalker';
  if (t.includes('battle')) return 'Battle';
  if (t.includes('instant')) return 'Instant';
  if (t.includes('sorcery')) return 'Sorcery';
  if (t.includes('enchantment')) return 'Enchantment';
  if (t.includes('artifact')) return 'Artifact';
  return 'Other';
}

/* ── Faceted filtering (shared-collection filter popover) ─────────────────
 * All filters are multi-select (OR within a facet) and compose with AND
 * across facets, matching the main collection's filter semantics. Empty
 * facets are no-ops. Range facets exclude "unknown" values (price 0 = no
 * price recorded; cmc undefined) when a bound is set — same as the
 * collection page, so a value/mana-value range never silently includes
 * cards with no data. */

export interface SharedFilters {
  /** Color identity codes (W/U/B/R/G + C for colorless). */
  colors: Set<string>;
  rarities: Set<string>;
  types: Set<DeckBucketKey>;
  /** Set codes (lowercase, as stored). */
  sets: Set<string>;
  priceMin?: number;
  priceMax?: number;
  cmcMin?: number;
  cmcMax?: number;
}

export function emptySharedFilters(): SharedFilters {
  return { colors: new Set(), rarities: new Set(), types: new Set(), sets: new Set() };
}

/** Count of active facets — drives the trigger badge. Each color/rarity/type/
 *  set selection counts once; each range counts once if either bound is set. */
export function countSharedFilters(f: SharedFilters): number {
  return (
    f.colors.size +
    f.rarities.size +
    f.types.size +
    f.sets.size +
    (f.priceMin !== undefined || f.priceMax !== undefined ? 1 : 0) +
    (f.cmcMin !== undefined || f.cmcMax !== undefined ? 1 : 0)
  );
}

function inRange(value: number, min: number | undefined, max: number | undefined): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * Per-card filter predicate — the shared core used by both the flat collection
 * view (via applySharedFilters) and the sectioned binder/deck views (which
 * filter each section's cards in place). Empty facets pass.
 */
export function matchesSharedFilters(card: PublicCard, f: SharedFilters): boolean {
  if (f.colors.size > 0) {
    const ci = card.colorIdentity ?? [];
    const colorOk = (f.colors.has('C') && ci.length === 0) || ci.some((c) => f.colors.has(c));
    if (!colorOk) return false;
  }
  if (f.rarities.size > 0 && !f.rarities.has(card.rarity.toLowerCase())) return false;
  if (f.types.size > 0 && !f.types.has(deckBucketFor(card.typeLine))) return false;
  if (f.sets.size > 0 && !f.sets.has(card.setCode)) return false;
  if (f.priceMin !== undefined || f.priceMax !== undefined) {
    if (!(card.purchasePrice > 0 && inRange(card.purchasePrice, f.priceMin, f.priceMax))) {
      return false;
    }
  }
  if (f.cmcMin !== undefined || f.cmcMax !== undefined) {
    if (!(card.cmc !== undefined && inRange(card.cmc, f.cmcMin, f.cmcMax))) return false;
  }
  return true;
}

export function applySharedFilters(grouped: GroupedCard[], f: SharedFilters): GroupedCard[] {
  return grouped.filter((g) => matchesSharedFilters(g.card, f));
}

/** Rarities present in the data, ordered mythic→common (then unknown). */
export function availableRarities(cards: PublicCard[]): string[] {
  const present = new Set(cards.map((c) => c.rarity.toLowerCase()));
  return [...present].sort((a, b) => rarityRank(a) - rarityRank(b));
}

/** Type buckets present in the data, in reader-friendly decklist order. */
export function availableTypes(cards: PublicCard[]): DeckBucketKey[] {
  const present = new Set(cards.map((c) => deckBucketFor(c.typeLine)));
  return DECK_BUCKET_ORDER.filter((t) => present.has(t));
}

/** Sets present in the data as {code,name}, ordered by set name. */
export function availableSets(cards: PublicCard[]): Array<{ code: string; name: string }> {
  const byCode = new Map<string, string>();
  for (const c of cards) byCode.set(c.setCode, c.setName || c.setCode);
  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
