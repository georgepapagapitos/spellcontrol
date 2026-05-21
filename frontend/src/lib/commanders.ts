import type { ScryfallCard } from '@/deck-builder/types';
import { isCommanderEligibleFrom } from '@spellcontrol/binder-routing';

/**
 * Commander-eligibility shim. The shape-agnostic core
 * (`isCommanderEligibleFrom`) and the binder-path `EnrichedCard` overload
 * (`isCommanderEligible`) live in the isomorphic `@spellcontrol/binder-routing`
 * package — re-exported here so existing import paths stay stable.
 *
 * `isValidCommander` stays frontend-only: it depends on the deck-builder's
 * `ScryfallCard` type, which the zero-dep package can't reference. It
 * delegates to the same core so the two definitions cannot drift.
 */
export { isCommanderEligibleFrom, isCommanderEligible } from '@spellcontrol/binder-routing';

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
