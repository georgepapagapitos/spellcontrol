/**
 * Scoring for the Daily card puzzle (E558): a guess is compared with the answer
 * on five attributes. Ported from the frontend's original scorer, same rules:
 *
 *   colors  hit on the same set; near when they share a color
 *   mana    hit, or an arrow saying the answer is higher or lower
 *   type    hit on the same main type; near when any card type is shared
 *   rarity  of the FIRST printing: hit, or near one step away
 *   year    of the first printing: hit, or an arrow
 */

export const RARITIES = ['common', 'uncommon', 'rare', 'mythic', 'special'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface CardAttrs {
  name: string;
  /** WUBRG letters in order; "" for colorless. */
  colors: string;
  mv: number;
  typeLine: string;
  rarity: Rarity;
  year: number;
}

/** `higher` / `lower` say where the ANSWER sits relative to the guess. */
export type Mark = 'hit' | 'near' | 'miss' | 'higher' | 'lower';

export interface GuessScore {
  colors: Mark;
  mv: Mark;
  type: Mark;
  rarity: Mark;
  year: Mark;
}

// Precedence for a card's MAIN type: an Artifact Creature is a creature first.
const TYPE_ORDER = [
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Kindred',
] as const;

/** The card types on the front face ("Legendary Artifact Creature — Golem" → Artifact, Creature). */
export function cardTypes(typeLine: string): string[] {
  const front = typeLine.split(' // ')[0] ?? '';
  const left = front.split(' — ')[0] ?? '';
  const words = new Set(left.split(/\s+/).map((w) => (w === 'Tribal' ? 'Kindred' : w)));
  return TYPE_ORDER.filter((t) => words.has(t));
}

/** The one type a card is known by, for the type cell's label. */
export function mainType(typeLine: string): string {
  return cardTypes(typeLine)[0] ?? (typeLine.split(' // ')[0] ?? '').split(' — ')[0] ?? '';
}

function arrow(guess: number, answer: number): Mark {
  if (guess === answer) return 'hit';
  return answer > guess ? 'higher' : 'lower';
}

export function scoreGuess(guess: CardAttrs, answer: CardAttrs): GuessScore {
  const shared = [...guess.colors].some((c) => answer.colors.includes(c));
  const colors: Mark = guess.colors === answer.colors ? 'hit' : shared ? 'near' : 'miss';

  const gTypes = cardTypes(guess.typeLine);
  const aTypes = cardTypes(answer.typeLine);
  const type: Mark =
    mainType(guess.typeLine) === mainType(answer.typeLine)
      ? 'hit'
      : gTypes.some((t) => aTypes.includes(t))
        ? 'near'
        : 'miss';

  const step = Math.abs(RARITIES.indexOf(guess.rarity) - RARITIES.indexOf(answer.rarity));
  const rarity: Mark = step === 0 ? 'hit' : step === 1 ? 'near' : 'miss';

  return {
    colors,
    mv: arrow(guess.mv, answer.mv),
    type,
    rarity,
    year: arrow(guess.year, answer.year),
  };
}
