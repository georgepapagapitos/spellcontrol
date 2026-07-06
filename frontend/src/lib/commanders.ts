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

/**
 * Pauper Commander (PDH) commander eligibility — DERIVED, because Scryfall
 * dropped the restricted=commander convention: uncommon commanders (Fynn, the
 * Fangbearer) read `not_legal` under the `paupercommander` legality key, so
 * neither `isValidCommander` nor `isCardLegal` can be reused here. The rule:
 * any creature printed at uncommon — deliberately NOT legendary-gated.
 *
 * `rarity` is per-printing: PDH commander pickers search `r:uncommon`, so the
 * printing they surface (and the deck stores) is the uncommon one. A card
 * whose stored printing is common/rare but that has an uncommon printing
 * elsewhere would false-negative — acceptable ceiling for now.
 */
export function isPdhCommanderEligible(card: ScryfallCard): boolean {
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  if (!typeLine.includes('Creature')) return false;
  if (card.legalities?.paupercommander === 'banned') return false;
  return card.rarity === 'uncommon';
}
