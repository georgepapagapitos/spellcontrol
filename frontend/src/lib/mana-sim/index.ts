/**
 * Goldfish manabase simulator: does this deck cast its spells on time, with
 * the right colours?
 *
 * A deterministic Monte-Carlo goldfish. Each game shuffles the library (the
 * commanders wait in the command zone), mulligans to a keepable hand, then
 * plays turns: draw, make the best land drop, spend the mana (ramp first, then
 * the commander, then the biggest spell). Every turn it also asks, for every
 * cost in the deck whose turn it is, "had you held this card now, and made
 * your land drops for it, could you cast it?", so a per-card castability
 * comes out of every game rather than only the games the card was drawn in.
 *
 * "Made your land drops for it" is what makes this a property of the mana
 * base and not of the land-drop heuristic: the lands drawn so far are
 * re-chosen for the card (as many as the drops actually made, plus today's),
 * with a land that would enter tapped usable only as an earlier drop and a
 * land drawn this turn only as today's. That is Karsten's question (were the
 * right lands drawn?) with taplands, fetches and ramp added, solved exactly
 * (`DropSupply` in `./cost.ts`). The heuristic's own drops drive the rest:
 * mana by turn, ramp, screw and flood.
 *
 * ## API
 *
 *   classifyManaCard(card, identityMask, opts?) → ManaCard   (once per card; cache it)
 *   buildManaDeck(commanders, library) → ManaDeck
 *   compileManaDeck({ commanders, library }, opts?) → ManaDeck (the two above in one)
 *   simulateManaDeck(deck, options?) → ManaSimResult
 *   evaluateManabase({ commanders, library }, options?) → ManaSimResult
 *
 * `library` is the 99 (98 with partners) with every copy listed, basics
 * included. Everything is sync and pure: the same deck and options give the
 * same numbers, independent of card order. The default seed is derived from the
 * card names.
 *
 * Comparing decks: pass one fixed `seed` so both variants see the same
 * shuffles (common random numbers). Each game draws its own random stream
 * from (seed, game index), and a shuffle permutes library POSITIONS, so the
 * two variants share games only when a swapped card sits in the slot of the
 * card it replaced: build the ManaDeck yourself with the library in a shared
 * slot order (`buildManaDeck` sorts by name, which moves every card between
 * the two names). The whole-deck objective does this (deckObjective/terms/mana.ts).
 *
 * ## What it measures (see `ManaSimResult`)
 *
 * - Mulligans: keep rate of the first seven and the mean kept size, by the
 *   app's `isKeepableHand` rule (the deck view's test hand uses the same).
 * - Land drops by turn, screw (a missed drop by turn 3 or 4) and flood (two or
 *   more land cards stuck in hand at the end of turn 6 with no spell left to
 *   cast: two dead draws, and mana with nothing to buy).
 * - Mana available each turn after the land drop, ramp included.
 * - Per card, P(castable on the turn equal to its mana value) and on the turn
 *   after, each also conditioned on the mana amount being there, so only
 *   colour can fail it (Karsten's measure, with ramp counted as mana), plus
 *   which colour was short. Commanders the same. Deck averages weigh every
 *   copy of every nonland spell once: one card is one draw's worth of the
 *   deck, and the per-card list is there for any other weighting. The count of
 *   spells under Karsten's (89 + mana value)% bar is the gate-shaped number.
 *
 * ## The model
 *
 * - Commander multiplayer rules by default: the first mulligan is free (CR
 *   103.4c) and the starting player draws on turn 1 (CR 800.7).
 * - Lands: shocks enter untapped (a goldfish pays the life); check, fast,
 *   slow, tango, bond, snarl and legendary-condition lands follow their
 *   condition; unrecognised conditions read as tapped. Fetch lands crack on
 *   entry for the land still in the library that serves the turn best (typed
 *   fetches can find duals and triomes; a fetch with nothing left to find
 *   finds nothing). Pathways and
 *   Thriving lands choose their colour on entry; Karoos bounce a land;
 *   Temple of the False God waits for five lands. A spell//land MDFC is played
 *   as a land only when no real land is in hand and its spell can't be cast
 *   that turn.
 * - Ramp: rocks (untapped ones usable the turn they land), dorks (from the
 *   next turn), land searches (Cultivate, Nature's Lore, Sakura-Tribe Elder,
 *   Harrow), one-shot Treasures, and Mana Vault-style rocks as one-shot mana.
 * - Paying a cost is an exact matching of pips to mana (Hall's theorem, see
 *   `./cost.ts`), so hybrid, {C} and multi-colour costs are handled exactly.
 *
 * ## Not modelled
 *
 * Card draw and card selection (a Brainstorm finds no land), cost reducers,
 * rituals, extra land drops, mana doublers and auras (Wild Growth), granted
 * mana abilities (Cryptolith Rite, Chromatic Lantern's land clause), X
 * Treasures (Dockside Extortionist) and Treasure engines, filter lands'
 * filtering (read as a dual), and spend restrictions ("spend this mana only
 * to cast creature spells" reads as unrestricted). A non-front face (an
 * adventure, a split card's second half) is not measured. Opponents never
 * interact. Surfaces should say it is a goldfish.
 *
 * ## Validation
 *
 * `karsten.test.ts` reproduces Frank Karsten's published 99-card colour-source
 * table with his assumptions (`mulligan: 'karsten'`, 41 lands): every cost
 * shape at its published minimum and at 15 sources lands within four standard
 * errors of his figure (20k games per cell; the largest gap measured was 1.1
 * points, with no systematic sign). `real-decks.test.ts` checks the metric moves the right way on
 * real decks (fixing stripped, 33 vs 38 lands, taplands vs untapped duals).
 *
 * ## Cost
 *
 * One game is tens of microseconds; the default 1,000 games of a 99-card
 * deck take roughly 20–45 ms (a five-colour, fetch-heavy list is the slow
 * end), linear in `games`. Classifying a deck's cards is a one-off ~10–20 ms;
 * an optimizer should classify each candidate card once and reuse it through
 * `buildManaDeck`.
 */

import type { ScryfallCard } from '@/deck-builder/types';
import { classifyManaCard, type ClassifyOptions } from './classify';
import { maskOf } from './cost';
import { simulateManaDeck } from './engine';
import type { ManaCard, ManaDeck, ManaMask, ManaSimOptions, ManaSimResult } from './types';

export {
  classifyManaCard,
  parseLandEntry,
  parseLandSearch,
  type ClassifyOptions,
} from './classify';
export { canPay, maskOf, parseManaCost } from './cost';
export { FLOOD_SURPLUS, FLOOD_TURN, simulateManaDeck } from './engine';
export * from './types';

/** Commander colour identity as a mask (the commanders' identities united). */
export function identityMask(commanders: readonly ScryfallCard[]): ManaMask {
  let m = 0;
  for (const c of commanders) m |= maskOf(c.color_identity ?? []);
  return m;
}

const byName = (a: ManaCard, b: ManaCard): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * Assemble a deck from classified cards (classify them all against the same
 * identity). Commanders and library are put in name order so input order can
 * never move a result.
 */
export function buildManaDeck(
  commanders: readonly ManaCard[],
  library: readonly ManaCard[]
): ManaDeck {
  return { commanders: [...commanders].sort(byName), library: [...library].sort(byName) };
}

export interface ManaDeckInput {
  /** The command zone: a commander, partners, a commander and its Background. */
  commanders: readonly ScryfallCard[];
  /** Every other card, one entry per copy. */
  library: readonly ScryfallCard[];
}

/**
 * Classify every card (once per name) and assemble the deck. The identity is
 * the commanders'; with no commander, the union of the library's.
 */
export function compileManaDeck(input: ManaDeckInput, opts: ClassifyOptions = {}): ManaDeck {
  const identity =
    input.commanders.length > 0 ? identityMask(input.commanders) : identityMask(input.library);
  const cache = new Map<string, ManaCard>();
  const classify = (card: ScryfallCard): ManaCard => {
    let c = cache.get(card.name);
    if (!c) {
      c = classifyManaCard(card, identity, opts);
      cache.set(card.name, c);
    }
    return c;
  };
  return buildManaDeck(input.commanders.map(classify), input.library.map(classify));
}

/** Compile and simulate in one call. */
export function evaluateManabase(
  input: ManaDeckInput,
  options: ManaSimOptions = {},
  classify: ClassifyOptions = {}
): ManaSimResult {
  return simulateManaDeck(compileManaDeck(input, classify), options);
}
