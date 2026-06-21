// Tag a card's archetype axes for cube generation, reusing the deck-builder's
// synergy classifier (a labeled-corpus, ≥0.9 precision/recall pure function).
// Keeps cube generation's one synergy dependency in a single place so the
// CubeCard build sites stay declarative.
//
// NB: we do NOT treat every instant/sorcery as a spellslinger enabler. Spells
// are universal, so doing so makes spellslinger the dominant "archetype" for
// any collection and floods the high-synergy reserve with spells. Spellslinger
// rides the classifier's genuine (narrow) producers, and its payoffs get fuel
// from the spells the cube naturally already contains.
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import type { CardLike } from '@/deck-builder/services/synergy/text';
import type { AxisKey } from '@/deck-builder/services/synergy/axes';

export interface SynergyTags {
  /** Archetype axes this card enables (e.g. sacrifice outlet, token maker). */
  synergyProducers: AxisKey[];
  /** Archetype axes this card pays off (e.g. rewards creatures dying). */
  synergyPayoffs: AxisKey[];
}

export function synergyTags(card: CardLike): SynergyTags {
  const { producers, payoffs } = classifyCard(card);
  return {
    synergyProducers: producers.map((r) => r.axis),
    synergyPayoffs: payoffs.map((r) => r.axis),
  };
}
