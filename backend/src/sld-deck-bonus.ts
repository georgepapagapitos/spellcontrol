/**
 * A Secret Lair Commander Deck's bonus cards (Odds and Ends' foil Perplexing
 * Chimera #7039), read from the `deckBonus` list in the SLD drops snapshot.
 * MTGJSON's compiled deck files omit them; the snapshot script takes them from
 * the upstream sealed-content YAML (frontend/scripts/sld-deck-bonus.mjs).
 * Missing snapshot (dev/test) → no bonus cards, never an error.
 */
import { readFileSync } from 'node:fs';
import { sldDropsSnapshotPath } from './shares/card-sld-drops';
import type { BonusCard } from './product-map';

let byDeck: Map<string, BonusCard[]> | null = null;

export function sldDeckBonus(deckName: string): BonusCard[] {
  if (!byDeck) {
    byDeck = new Map();
    try {
      const data = JSON.parse(readFileSync(sldDropsSnapshotPath(), 'utf8')) as {
        deckBonus?: { deck?: unknown; cards?: unknown }[];
      };
      for (const entry of data.deckBonus ?? []) {
        if (typeof entry.deck !== 'string' || !Array.isArray(entry.cards)) continue;
        const cards = (entry.cards as Partial<BonusCard>[]).filter(
          (c): c is BonusCard => typeof c.name === 'string' && typeof c.number === 'string'
        );
        byDeck.set(
          entry.deck,
          cards.map((c) => ({ ...c, foil: Boolean(c.foil) }))
        );
      }
    } catch {
      // No snapshot on disk (dev/test): products keep MTGJSON's own zones.
    }
  }
  return byDeck.get(deckName) ?? [];
}

/** Test seam: drop the cached list so a changed snapshot path is re-read. */
export function resetSldDeckBonusCache(): void {
  byDeck = null;
}
