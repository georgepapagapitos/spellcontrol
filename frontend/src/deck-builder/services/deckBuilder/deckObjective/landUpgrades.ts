/**
 * Land upgrades (E509): a nonbasic land from the owned collection for a basic.
 *
 * The generator meets a land only through the commander page's land list, so an
 * owned dual, check land or utility land the page never ranked has no way into
 * a collection build. The search seats one by swapping it for a basic: a 1:1
 * move that keeps the land count the plan chose, judged by the mana term (colour
 * sources against pip demand, an enters-tapped land against the curve, all in
 * the goldfish) like any other swap.
 *
 * Two things set these moves apart from the spell and land swaps:
 *  - The quality term credits a nonbasic land its popularity and a basic zero,
 *    which would pay every owned land for replacing a basic whatever it does
 *    for the mana. The move's bar is raised by that credit, so only what the
 *    land does for the mana earns its slot.
 *  - The fast terms leave the goldfish out, and the goldfish is the whole case
 *    for a land, so the moves are ranked by a cheap goldfish (few games) and the
 *    best few are judged in full.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { ANY_COLOR } from '@/lib/mana-sim/types';
import { isBasicLand, isLandCard } from './context';
import { scoreDeck } from './index';
import { OWNED_BONUS, isCollectionBuild } from './terms/ownership';
import type { ObjectiveContext, ObjectiveDeck } from './types';

/** Games in the ranking goldfish: a tenth of the full read, enough to order moves. */
export const SCREEN_GAMES = 400;
/** Land upgrades a deck gets: a few corrections to the mana, not a rebuild of it. */
export const MAX_LAND_UPGRADES = 3;
/** Full scores land moves may spend in a search, apart from the spell swaps' budget. */
export const MAX_LAND_EVALUATIONS = 120;
/** Land upgrades judged in full per step. */
export const UPGRADES_PER_STEP = 6;

/**
 * Whether a land makes mana only by paying mana: a filter ("{1}, {T}: Add one
 * mana of any color", Daily Bugle Building, Captivating Cave). The goldfish
 * classifies a land from Scryfall's produced_mana, which lists the paid
 * ability's colours too, so it reads such a land as a free any-colour source
 * and pays it to replace a basic (E509 gate 1). Left out of the upgrades until
 * the classifier models the filter step.
 *
 * ponytail: text test, not a model of the filter. Ceiling: a filter land
 * (Mystic Gate) never upgrades a basic. Upgrade path: parse the paid clause in
 * lib/mana-sim/classify.ts, then drop this.
 */
export function paysForMana(land: ScryfallCard): boolean {
  const faces = (land.card_faces ?? []).map((f) => f.oracle_text ?? '');
  const lines = [land.oracle_text ?? '', ...faces].join('\n').toLowerCase().split('\n');
  return lines.some((line) => {
    const m = /^([^:]*):\s*add\b/.exec(line.trim());
    return m !== null && /\{[^}]*\}/.test(m[1].replace(/\{t\}|\{q\}/g, ''));
  });
}

/**
 * Whether a land gives the deck colour: it taps for one, or fetches one. A
 * colourless utility land (Springjack Pasture, Scorched Ruins) is a choice the
 * generator's land plan makes from the page; swapped in for a basic it reads as
 * a mana gain in the goldfish only by its text's quirks (gate 2), so a land
 * upgrade must still tap for colour.
 */
export function givesColour(land: ScryfallCard, ctx: ObjectiveContext): boolean {
  const face = ctx.manaCardOf(land).land;
  return !!face && (face.fetch !== null || (landColours(land, ctx) & ANY_COLOR) !== 0);
}

/** The colours a land taps for, as the goldfish reads them (0 = colourless or none). */
export function landColours(card: ScryfallCard, ctx: ObjectiveContext): number {
  const face = ctx.manaCardOf(card).land;
  return face ? face.units.reduce((m, u) => m | u, 0) : 0;
}

export interface LandUpgrade {
  /** Index in the deck of the basic that leaves. */
  out: number;
  land: ScryfallCard;
}

/**
 * The basics a land could replace: the most numerous basic it shares a colour
 * with (it still taps for that colour), and the most numerous it doesn't (a
 * dual adds a second colour while giving up a surplus one). A colourless land
 * takes the most numerous basic. At most two per land, ties by name.
 */
export function landUpgrades(
  deck: ObjectiveDeck,
  lands: readonly ScryfallCard[],
  ctx: ObjectiveContext
): LandUpgrade[] {
  const basics = new Map<string, { index: number; count: number; colours: number }>();
  deck.cards.forEach((c, index) => {
    if (!isBasicLand(c)) return;
    const seen = basics.get(c.name);
    if (seen) seen.count++;
    else basics.set(c.name, { index, count: 1, colours: landColours(c, ctx) });
  });
  const ranked = [...basics.entries()].sort(
    ([an, a], [bn, b]) => b.count - a.count || (an < bn ? -1 : 1)
  );
  const inDeck = new Set(deck.cards.map((c) => c.name));
  const out: LandUpgrade[] = [];
  for (const land of lands) {
    if (!isLandCard(land) || isBasicLand(land) || inDeck.has(land.name)) continue;
    const mine = landColours(land, ctx);
    const shares = ranked.find(([, b]) => (b.colours & mine) !== 0);
    const apart = ranked.find(([, b]) => (b.colours & mine) === 0);
    const picks = mine === 0 ? [ranked[0]] : [shares, apart];
    for (const pick of picks) if (pick) out.push({ out: pick[1].index, land });
  }
  return out;
}

/**
 * What the score already credits a land for besides the mana: its popularity on
 * the page (a basic reads zero) and, under "lean on mine", the owned bonus
 * (ownership.ts skips basics). A land upgrade's bar is raised by it.
 */
export function landCredit(land: ScryfallCard, ctx: ObjectiveContext): number {
  const prefer = isCollectionBuild(ctx) && ctx.customization.collectionStrategy === 'prefer';
  return ctx.qualityOf(land).q + (prefer ? OWNED_BONUS : 0);
}

/** A second goldfish seed: other shuffles, the same decks. */
const REPLICATION_SEED_STEP = 7919;

/** Whether the swap from `before` to `after` clears `required` on other games too. */
export function replicates(
  before: ObjectiveDeck,
  after: ObjectiveDeck,
  ctx: ObjectiveContext,
  required: number
): boolean {
  const other = { ...ctx, sim: { ...ctx.sim, seed: ctx.sim.seed + REPLICATION_SEED_STEP } };
  return scoreDeck(after, other).total - scoreDeck(before, other).total >= required;
}
