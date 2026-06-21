// Tag a card's archetype axes for cube generation, reusing the deck-builder's
// synergy classifier (a labeled-corpus, ≥0.9 precision/recall pure function).
// Keeps cube generation's one synergy dependency in a single place so the
// CubeCard build sites stay declarative.
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import type { CardLike } from '@/deck-builder/services/synergy/text';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

export interface SynergyTags {
  /** Archetype axes this card enables (e.g. sacrifice outlet, token maker). */
  synergyProducers: AxisKey[];
  /** Archetype axes this card pays off (e.g. rewards creatures dying). */
  synergyPayoffs: AxisKey[];
}

/**
 * One cube-specific adjustment over the raw classifier: every instant/sorcery
 * counts as a spellslinger enabler. The deck-builder classifier deliberately
 * narrows that axis to cost-reducers, but in a cube the spells themselves are
 * the fuel that makes a spellslinger payoff worth drafting.
 */
export function synergyTags(card: CardLike): SynergyTags {
  const { producers, payoffs } = classifyCard(card);
  const synergyProducers = producers.map((r) => r.axis);
  if (
    /\b(instant|sorcery)\b/i.test(card.type_line ?? '') &&
    !synergyProducers.includes('spellslinger')
  ) {
    synergyProducers.push('spellslinger');
  }
  return { synergyProducers, synergyPayoffs: payoffs.map((r) => r.axis) };
}
