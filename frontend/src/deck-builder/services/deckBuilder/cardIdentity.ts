// Card identity helpers shared by the shipped-deck checker (deckInvariants.ts)
// and the whole-deck objective's hard constraints (deckObjective/). A LEAF:
// it imports only types, so a module the generator depends on can use it
// without dragging deckGenerator.ts back in (deckInvariants value-imports the
// generator for one constant; the objective must not).
import type { ScryfallCard } from '@/deck-builder/types';

/** Case/punctuation/diacritic-insensitive name key. Mirrors the generator's
 *  must-include `normalizeName` (deckGenerator.ts), plus diacritics, so
 *  "Lim-Dûl" and "Lim-Dul" agree. */
export function normalizeCardName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isBasic(card: ScryfallCard): boolean {
  const front =
    card.card_faces && card.card_faces.length >= 2 && card.card_faces[0]?.type_line
      ? card.card_faces[0].type_line
      : card.type_line || '';
  return /\bBasic\b/.test(front);
}

function oracleText(card: ScryfallCard): string {
  return [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)]
    .filter(Boolean)
    .join('\n');
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

/**
 * How many copies the card's own oracle text allows: "A deck can have any
 * number of cards named X" (Relentless Rats) or "up to seven" (Seven
 * Dwarves). Read from the card itself rather than a hard-coded list, the same
 * way the generator's multi-copy pipeline detects them.
 */
export function copyLimit(card: ScryfallCard): number {
  if (isBasic(card)) return Infinity;
  const text = oracleText(card).toLowerCase();
  if (text.includes('a deck can have any number of cards named')) return Infinity;
  const m = /a deck can have up to (\w+) cards named/.exec(text);
  if (m) {
    const n = NUMBER_WORDS[m[1]] ?? parseInt(m[1], 10);
    return Number.isFinite(n) ? n : Infinity;
  }
  return 1;
}
