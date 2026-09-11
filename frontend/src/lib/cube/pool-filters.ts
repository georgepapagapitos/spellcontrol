import type { EnrichedCard } from '@/types';
import { getCardTags } from '@/lib/card-tags';
import { formatExclusion, type CubeFormat } from './play-format';

/**
 * Which owned cards a cube may draw from, decided per NAME over every copy
 * you own. These sit in front of the generator: it never sees a card the
 * filters hide, so the ranking and the refiner are untouched.
 *
 * - `source`: 'available' = at least one copy is free of any deck / physical
 *   cube (the default — what you can physically pull); 'spares' = available
 *   AND you own two or more copies, so a cube built from it never touches a
 *   deck's only copy; 'all' = every name you own.
 * - `maxPrice`: keep a name only if its CHEAPEST priced copy is at or under
 *   the ceiling (market price, display currency). A name with no priced copy
 *   is hidden and counted as `unpriced` rather than let through — prices are
 *   device-local, and an unpriced bulk cube would quietly admit the expensive
 *   cards whose prices had not loaded yet.
 * - `rarity`: 'pauper' keeps names with a common copy, 'peasant' a common or
 *   uncommon copy — the copy you own IS what goes in the cube, so it is the
 *   owned printing's rarity that counts, not the card's cheapest printing.
 * - `format`: the play format (see ./play-format). `limited` leaves out cards
 *   that need a commander or the command zone, and group-hug politics cards;
 *   `commander` leaves nothing out. Read from the card's oracle tags.
 */
export type PoolSource = 'available' | 'spares' | 'all';
export type RarityCap = 'any' | 'peasant' | 'pauper';
export interface PoolFilters {
  source: PoolSource;
  maxPrice: number | null;
  rarity: RarityCap;
  format: CubeFormat;
}
export const DEFAULT_POOL_FILTERS: PoolFilters = {
  source: 'available',
  maxPrice: null,
  rarity: 'any',
  format: 'limited',
};

/** Why each hidden name was left out — one reason per name, in filter order. */
export interface PoolHidden {
  /** Every copy is committed to a deck or another physical cube. */
  committed: number;
  /** `spares`: only one copy owned. */
  singles: number;
  /** No owned copy is within the rarity cap. */
  rarity: number;
  /** Cheapest priced copy is over `maxPrice`. */
  price: number;
  /** A ceiling is set but no copy has a price yet. */
  unpriced: number;
  /** `limited`: the card's rules text needs a commander or the command zone. */
  commanderOnly: number;
  /** `limited`: group-hug politics — it hands the one opponent cards too. */
  politics: number;
}

const RARITY_OK: Record<RarityCap, (rarity: string) => boolean> = {
  any: () => true,
  peasant: (r) => r === 'common' || r === 'uncommon',
  pauper: (r) => r === 'common',
};

export function filterPool(
  collection: readonly EnrichedCard[],
  availableNames: ReadonlySet<string>,
  filters: PoolFilters,
  /** Oracle tags per card name — the bundled otag index by default; injected so the filter stays pure. */
  tagsOf: (name: string) => readonly string[] = getCardTags
): { names: string[]; hidden: PoolHidden } {
  const byName = new Map<string, EnrichedCard[]>();
  for (const c of collection) {
    if (!c.name) continue;
    const rows = byName.get(c.name);
    if (rows) rows.push(c);
    else byName.set(c.name, [c]);
  }
  const hidden: PoolHidden = {
    committed: 0,
    singles: 0,
    rarity: 0,
    price: 0,
    unpriced: 0,
    commanderOnly: 0,
    politics: 0,
  };
  const names: string[] = [];
  for (const [name, rows] of byName) {
    if (filters.source !== 'all' && !availableNames.has(name)) {
      hidden.committed++;
      continue;
    }
    if (filters.source === 'spares' && rows.length < 2) {
      hidden.singles++;
      continue;
    }
    const excluded = formatExclusion(filters.format, tagsOf(name));
    if (excluded) {
      hidden[excluded]++;
      continue;
    }
    if (!rows.some((r) => RARITY_OK[filters.rarity](r.rarity))) {
      hidden.rarity++;
      continue;
    }
    if (filters.maxPrice != null) {
      const priced = rows.map((r) => r.purchasePrice).filter((p) => p > 0);
      if (priced.length === 0) {
        hidden.unpriced++;
        continue;
      }
      if (Math.min(...priced) > filters.maxPrice) {
        hidden.price++;
        continue;
      }
    }
    names.push(name);
  }
  return { names, hidden };
}
