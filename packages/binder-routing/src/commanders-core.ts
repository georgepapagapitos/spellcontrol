import type { EnrichedCard } from './types.js';

/**
 * Shape-agnostic commander-eligibility core. A card is commander-eligible
 * iff it is a legendary creature (or its text declares "can be your
 * commander") AND it is legal/restricted in the Commander format.
 *
 * Every card-shaped caller (deck-builder ScryfallCard, binder EnrichedCard)
 * funnels through this so the definitions cannot drift. The deck-builder's
 * `isValidCommander(ScryfallCard)` lives in the frontend (it depends on a
 * deck-builder-only type) and delegates to `isCommanderEligibleFrom` here.
 */
export function isCommanderEligibleFrom(
  typeLine: string,
  oracleText: string,
  commanderLegality: string | undefined
): boolean {
  const tl = typeLine.toLowerCase();
  const ot = oracleText.toLowerCase();
  const isLegendaryCreature = tl.includes('legendary') && tl.includes('creature');
  const canBeCommander = ot.includes('can be your commander');
  if (!isLegendaryCreature && !canBeCommander) return false;
  return commanderLegality === 'legal' || commanderLegality === 'restricted';
}

/**
 * Binder-path commander-eligibility check over an EnrichedCard. `typeLine` /
 * `oracleText` already join multi-face cards (per their type docs);
 * `oracleText` is stored lowercased but the core lowercases defensively.
 * Missing fields → not eligible.
 */
export function isCommanderEligible(card: EnrichedCard): boolean {
  return isCommanderEligibleFrom(
    card.typeLine ?? '',
    card.oracleText ?? '',
    card.legalities?.commander
  );
}
