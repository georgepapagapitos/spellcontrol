/**
 * Shared helper: build a CardTally list from an AxisSummary + the deck card list.
 * Used by PlaystyleRadar and EnginePanel for their axis tap-through drill-downs.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import type { AxisSummary } from './deckSynergy';
import type { CardTally } from '@/components/deck/useCardCarousel';

/**
 * Build the CardTally list for an axis tap-through.
 * Producers and payoffs from `AxisSummary` are card names (may overlap); we
 * deduplicate by name, then resolve count + ScryfallCard from the deck list.
 */
export function buildAxisTally(axis: AxisSummary, allCards: ScryfallCard[]): CardTally[] {
  // Deduplicate names across producers and payoffs
  const names = new Set<string>();
  for (const p of axis.producers) names.add(p.name);
  for (const o of axis.payoffs) names.add(o.name);

  // Build a name→card+count lookup from the deck list
  const byName = new Map<string, { card: ScryfallCard; count: number }>();
  for (const card of allCards) {
    const entry = byName.get(card.name);
    if (entry) {
      entry.count++;
    } else {
      byName.set(card.name, { card, count: 1 });
    }
  }

  return [...names]
    .map((name) => {
      const entry = byName.get(name);
      return {
        name,
        count: entry?.count ?? 1,
        card: entry?.card,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
