import type { ScryfallCard } from '@/deck-builder/types';

/**
 * True if the card is a legal commander: a legendary creature (or a card
 * whose text declares "can be your commander") that is legal in the
 * Commander format on Scryfall.
 */
export function isValidCommander(card: ScryfallCard): boolean {
  const typeLine = (card.type_line ?? card.card_faces?.[0]?.type_line ?? '').toLowerCase();
  const oracleText = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).toLowerCase();
  const isLegendaryCreature = typeLine.includes('legendary') && typeLine.includes('creature');
  const canBeCommander = oracleText.includes('can be your commander');
  if (!isLegendaryCreature && !canBeCommander) return false;
  const legality = card.legalities?.commander;
  return legality === 'legal' || legality === 'restricted';
}
