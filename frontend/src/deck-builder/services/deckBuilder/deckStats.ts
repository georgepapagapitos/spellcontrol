// Deck statistics (mana curve, average CMC, color & type distribution).
// Pure — extracted verbatim from deckGenerator.ts. Re-exported from
// deckGenerator.ts to keep the existing public import path stable.
import type { ScryfallCard, DeckCategory, DeckStats } from '@/deck-builder/types';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';

/**
 * A card's mana value, read off the front face when the card carries none
 * at the top level. Scryfall's reversible printings (the Secret Lair "Krark's
 * Thumb // Krark's Thumb" layout) keep cmc, type line and text on each face
 * only, so `card.cmc` is undefined and a curve bucketed on it shipped a "NaN"
 * key (E527). Never NaN: a card with no mana value anywhere counts as 0,
 * like a land.
 */
export function cardManaValue(card: ScryfallCard): number {
  if (Number.isFinite(card.cmc)) return card.cmc;
  // Scryfall sends a per-face cmc on reversible cards; the face type doesn't
  // model it because no other layout has one.
  const faceCmc = (card.card_faces?.[0] as { cmc?: number } | undefined)?.cmc;
  return typeof faceCmc === 'number' && Number.isFinite(faceCmc) ? faceCmc : 0;
}

// Calculate deck statistics
export function calculateStats(categories: Record<DeckCategory, ScryfallCard[]>): DeckStats {
  const allCards = Object.values(categories).flat();
  // Land-ness is decided by actual category membership (categories.lands),
  // not a re-derived type check — an MDFC can be filed under a spell role
  // (front face "Instant") or under lands (picked as manabase) depending on
  // where the generator put it; that placement is the single source of truth
  // so it's never double-counted or curve-leaked either direction.
  const landSet = new Set(categories.lands);
  const nonLandCards = allCards.filter((card) => !landSet.has(card));

  // Mana curve
  const manaCurve: Record<number, number> = {};
  nonLandCards.forEach((card) => {
    const cmc = Math.min(Math.floor(cardManaValue(card)), 7); // Cap at 7+
    manaCurve[cmc] = (manaCurve[cmc] || 0) + 1;
  });

  // Average CMC
  const totalCmc = nonLandCards.reduce((sum, card) => sum + cardManaValue(card), 0);
  const averageCmc = nonLandCards.length > 0 ? totalCmc / nonLandCards.length : 0;

  // Color distribution — CARD count by Scryfall `colors` (color identity),
  // one tally per card per color it's in. Deliberately NOT a mana-pip count
  // (a card costing {R}{R} still adds exactly 1 to R here) — that's a
  // different, already-correct metric (`manabase.lines[].pips`). E78 item 4:
  // a critic hand-tallying mana symbols found a higher number than this
  // field and read it as a bug; the two fields answer different questions.
  const colorDistribution: Record<string, number> = {};
  allCards.forEach((card) => {
    const colors = card.colors || [];
    if (colors.length === 0) {
      colorDistribution['C'] = (colorDistribution['C'] || 0) + 1;
    } else {
      colors.forEach((color) => {
        colorDistribution[color] = (colorDistribution[color] || 0) + 1;
      });
    }
  });

  // Type distribution — a card in categories.lands (including a land-picked
  // MDFC) counts once as Land; everything else buckets by front-face type,
  // checked creature-first (so "Enchantment Creature" reads as Creature here
  // — see enchantmentPermanentCount below for the non-exclusive total).
  const typeDistribution: Record<string, number> = { Planeswalker: 0 };
  let enchantmentPermanentCount = 0;
  allCards.forEach((card) => {
    if (landSet.has(card)) {
      typeDistribution['Land'] = (typeDistribution['Land'] || 0) + 1;
      return;
    }
    const typeLine = getFrontFaceTypeLine(card).toLowerCase();
    if (typeLine.includes('enchantment')) enchantmentPermanentCount++;
    if (typeLine.includes('creature'))
      typeDistribution['Creature'] = (typeDistribution['Creature'] || 0) + 1;
    else if (typeLine.includes('instant'))
      typeDistribution['Instant'] = (typeDistribution['Instant'] || 0) + 1;
    else if (typeLine.includes('sorcery'))
      typeDistribution['Sorcery'] = (typeDistribution['Sorcery'] || 0) + 1;
    else if (typeLine.includes('artifact'))
      typeDistribution['Artifact'] = (typeDistribution['Artifact'] || 0) + 1;
    else if (typeLine.includes('enchantment'))
      typeDistribution['Enchantment'] = (typeDistribution['Enchantment'] || 0) + 1;
    else if (typeLine.includes('planeswalker'))
      typeDistribution['Planeswalker'] = (typeDistribution['Planeswalker'] || 0) + 1;
    else if (typeLine.includes('battle'))
      typeDistribution['Battle'] = (typeDistribution['Battle'] || 0) + 1;
  });

  return {
    totalCards: allCards.length,
    averageCmc: Math.round(averageCmc * 100) / 100,
    manaCurve,
    colorDistribution,
    typeDistribution,
    enchantmentPermanentCount,
  };
}
