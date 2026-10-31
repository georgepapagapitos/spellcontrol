// E1058: a combo seating is not taken while two single swaps over its slots outscore it.
//
// A combo seating takes the deck's two weakest slots, so the single swaps it
// would have made there are lost with them. On Talrand (E1052 V1 panel,
// 2026-10-31) Narset's Reversal + Isochron Scepter took the slots Fierce
// Guardianship and Mana Drain filled otherwise: the seating cleared its bar
// first by fast estimate, though the singles scored higher in full (66.57
// against 66.19 from a 65.08 seed). Pure; the caller supplies the full score.
import type { ScryfallCard } from '@/deck-builder/types';
import { getByCardName } from '@/lib/cards/card-text';
import { isLandCard } from './context';
import { answerValue, protectionValue } from './terms/interaction';
import type { ObjectiveContext } from './types';
import type { Move } from './searchMoves';

/** Premium singles tried per slot, besides the slot's best single. */
const SINGLES_PER_SLOT = 3;
/** An answer or protection piece worth this much (interaction.ts) ... */
const PREMIUM_ANSWER_VALUE = 0.7;
/** ... that this share (%) of the commander's decks play, is a premium answer. */
const PREMIUM_ANSWER_MIN_PCT = 15;

/** A counter or protection piece the commander's decks play (Mana Drain,
 *  Fierce Guardianship, Swan Song), not any card with a good answer value. */
export function isPremiumAnswer(
  c: ScryfallCard,
  ctx: Pick<ObjectiveContext, 'factsOf' | 'edhrec'>
): boolean {
  if (isLandCard(c)) return false;
  const facts = ctx.factsOf(c);
  const v = Math.max(answerValue(c, facts)?.v ?? 0, protectionValue(c, facts));
  return (
    v >= PREMIUM_ANSWER_VALUE &&
    (getByCardName(ctx.edhrec, c.name)?.inclusion ?? 0) >= PREMIUM_ANSWER_MIN_PCT
  );
}

/**
 * Whether a pair of singles over the combo seating's two slots outscores it:
 * each slot takes a premium answer or its best single, and at least one takes
 * a premium answer. `scorePair` is the full score (null when the pair can't be
 * taken), against the same slot reference as the seating, so the same
 * goldfish games. Not charged to the evaluation budget: it runs only for a
 * seating already about to be taken.
 */
export function singlesOutscore(
  combo: Move,
  comboTotal: number,
  moves: readonly Move[],
  premium: (c: ScryfallCard) => boolean,
  scorePair: (pair: Move) => number | null
): boolean {
  const comboIns = new Set(combo.in.map((c) => c.name));
  const [first, second] = combo.out.map((o) => {
    const singles = moves.filter(
      (m) =>
        m.kind === 'improve' &&
        m.landUp === undefined &&
        m.out.length === 1 &&
        m.out[0] === o &&
        !comboIns.has(m.in[0].name)
    );
    const best = singles.filter((m) => premium(m.in[0])).slice(0, SINGLES_PER_SLOT);
    return [...best, ...singles.filter((m) => !best.includes(m)).slice(0, 1)];
  });
  for (const a of first ?? [])
    for (const b of second ?? []) {
      if (a.in[0].name === b.in[0].name) continue;
      if (!premium(a.in[0]) && !premium(b.in[0])) continue;
      const total = scorePair({
        out: [a.out[0], b.out[0]],
        in: [a.in[0], b.in[0]],
        kind: 'improve',
        estimate: a.estimate + b.estimate,
      });
      if (total !== null && total > comboTotal) return true;
    }
  return false;
}
