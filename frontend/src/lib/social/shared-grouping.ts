import type { PublicCard } from './shared-types';
import { normalizeForSearch } from '@/lib/search/normalize-search';
import { nameMatchesNormalized, printedName } from '@spellcontrol/binder-routing';

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

export type SharedSortKey =
  | 'name'
  | 'cmc'
  | 'price'
  | 'set'
  | 'rarity'
  | 'qty'
  | 'popularity'
  /** An interest ranking the caller supplies (the collection browser's
   *  `priority`); `sortGrouped` has no data to order it by. */
  | 'priority';
export type SortDir = 'asc' | 'desc';

const RARITY_ORDER: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
};

function rarityRank(r: string): number | undefined {
  return RARITY_ORDER[r.toLowerCase()];
}

/**
 * Compare two values where "unknown" (undefined) sorts last in BOTH
 * directions: never flipped by `sign`, so a descending sort doesn't lead with
 * the cards that have no value (memory project_unknown_sorts_last). Returns
 * `null` when both are known so the caller compares them normally.
 */
function unknownLast(a: number | undefined, b: number | undefined): number | null {
  if (a !== undefined && b !== undefined) return null;
  if (a === undefined && b === undefined) return 0;
  return a === undefined ? 1 : -1;
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
        diff = printedName(a.card).localeCompare(printedName(b.card));
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
      case 'rarity': {
        const ra = rarityRank(a.card.rarity);
        const rb = rarityRank(b.card.rarity);
        const last = unknownLast(ra, rb);
        if (last === null) diff = (ra as number) - (rb as number);
        else if (last !== 0) return last;
        break;
      }
      case 'qty':
        diff = a.quantity - b.quantity;
        break;
      case 'popularity': {
        // EDHREC rank 1 is the most popular card, so ascending reads
        // "most popular first". Unranked cards trail either way.
        const ra = a.card.edhrecRank;
        const rb = b.card.edhrecRank;
        const last = unknownLast(ra, rb);
        if (last === null) diff = (ra as number) - (rb as number);
        else if (last !== 0) return last;
        break;
      }
    }
    // Stable tie-break by name then setCode/collectorNumber so the order is
    // deterministic across renders (avoids List rendering shuffle on rerender).
    if (diff === 0) diff = printedName(a.card).localeCompare(printedName(b.card));
    if (diff === 0) diff = a.card.setCode.localeCompare(b.card.setCode);
    if (diff === 0) diff = a.card.collectorNumber.localeCompare(b.card.collectorNumber);
    return diff * sign;
  });
}

export function filterBySearch(grouped: GroupedCard[], query: string): GroupedCard[] {
  const nq = normalizeForSearch(query);
  if (!nq) return grouped;
  return grouped.filter((g) => nameMatchesNormalized(g.card, nq));
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
