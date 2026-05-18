import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '@/types';

/**
 * Shape-agnostic commander-eligibility core. A card is commander-eligible
 * iff it is a legendary creature (or its text declares "can be your
 * commander") AND it is legal/restricted in the Commander format.
 *
 * Every card-shaped caller (deck-builder ScryfallCard, binder EnrichedCard)
 * funnels through this so the two definitions cannot drift.
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
 * True if the card is a legal commander: a legendary creature (or a card
 * whose text declares "can be your commander") that is legal in the
 * Commander format on Scryfall.
 */
export function isValidCommander(card: ScryfallCard): boolean {
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  const oracleText =
    card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ?? '';
  return isCommanderEligibleFrom(typeLine, oracleText, card.legalities?.commander);
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
