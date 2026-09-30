/**
 * The candidate pool for the land-upgrade lane: lands the user owns, then the
 * on-color duals the page fetched, one entry per name. Shared by the deck page
 * and the Coach evaluation harness so both hand `computeLandUpgrades` the same
 * pool.
 */
import type { ScryfallCard } from '@/deck-builder/types';

/** The collection row fields a land needs to be judged (EnrichedCard's camelCase). */
export interface CollectionLandRow {
  name: string;
  typeLine?: string;
  oracleText?: string;
  manaCost?: string;
  cmc?: number;
  colorIdentity?: string[];
  layout?: string;
}

/** Collection lands as cards, one per name. */
export function collectionLandsAsCards(rows: readonly CollectionLandRow[]): ScryfallCard[] {
  const seen = new Set<string>();
  const out: ScryfallCard[] = [];
  for (const c of rows) {
    if (!c.typeLine?.toLowerCase().includes('land') || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({
      name: c.name,
      type_line: c.typeLine,
      oracle_text: c.oracleText,
      mana_cost: c.manaCost,
      cmc: c.cmc,
      color_identity: c.colorIdentity,
      layout: c.layout,
    } as ScryfallCard);
  }
  return out;
}

/** Owned lands first, then fetched ones, deduped by name. */
export function landUpgradeCandidates(
  owned: readonly ScryfallCard[],
  fetched: readonly ScryfallCard[]
): ScryfallCard[] {
  const seen = new Set<string>();
  return [...owned, ...fetched].filter((c) => !seen.has(c.name) && !!seen.add(c.name));
}
