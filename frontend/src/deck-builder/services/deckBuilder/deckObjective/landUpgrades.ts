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
import { buildManabaseSummary } from '../manabaseMath';
import { isOwnedCard } from './constraints';
import { isBasicLand, isLandCard } from './context';
import { applyMove } from './judge';
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

export interface RankedUpgrade extends LandUpgrade {
  /** landCredit(): what the score already credits the land besides the mana. */
  credit: number;
  /** The short goldfish's mana gain plus the fast terms', less the credit. */
  estimate: number;
}

/**
 * The land upgrades worth a full score this step: the owned nonbasic lands that
 * give colour and don't pay for their mana, each against the basics it could
 * replace, ranked by the short goldfish and kept to UPGRADES_PER_STEP.
 */
export function rankLandUpgrades(
  deck: ObjectiveDeck,
  addable: readonly ScryfallCard[],
  ctx: ObjectiveContext,
  allowed: (u: LandUpgrade) => boolean,
  partial: (deck: ObjectiveDeck, ctx: ObjectiveContext) => number,
  fastGain: (deck: ObjectiveDeck) => number
): RankedUpgrade[] {
  const lands = addable.filter((c) => isLandCard(c) && !isBasicLand(c) && isOwnedCard(c, ctx));
  const upgrades = landUpgrades(deck, lands, ctx).filter(allowed);
  if (upgrades.length === 0) return [];
  const screenCtx = { ...ctx, sim: { ...ctx.sim, games: SCREEN_GAMES } };
  const screenNow = partial(deck, screenCtx);
  return upgrades
    .map((u) => {
      const next = applyMove(deck, { out: [u.out], in: [u.land] });
      const credit = landCredit(u.land, ctx);
      return {
        ...u,
        credit,
        estimate: partial(next, screenCtx) - screenNow + fastGain(next) - credit,
      };
    })
    .filter((m) => m.estimate > 0)
    .sort((a, b) => b.estimate - a.estimate || a.land.name.localeCompare(b.land.name))
    .slice(0, UPGRADES_PER_STEP);
}

/**
 * A land that costs lands to enter (Scorched Ruins: "sacrifice two untapped
 * lands instead") is a net loss of lands the goldfish does not play out, and
 * its {C}{C}{C}{C} is not four sources. Left out of the land moves.
 *
 * Text test. Upgrade path: model the entry cost in the engine's land
 * face and drop this.
 */
export function sacrificesLandsToEnter(land: ScryfallCard): boolean {
  const faces = (land.card_faces ?? []).map((f) => f.oracle_text ?? '');
  const text = [land.oracle_text ?? '', ...faces].join('\n').toLowerCase();
  return /\benters?\b[^.\n]*,\s*sacrifice [^.\n]*\blands?\b/.test(text);
}

/** Nonbasic lands in a deck. */
export function nonbasicLands(deck: ObjectiveDeck): number {
  return deck.cards.filter((c) => isLandCard(c) && !isBasicLand(c)).length;
}

/**
 * Whether a land move gives up a colour source the deck is short of: the
 * manabase summary (the build report's own) finds a colour short after the
 * move, and the move took away a source of it. A colourless utility land for a
 * red source in a deck short of red (Faceless Haven in Krenko, gate 9).
 */
export function losesShortSource(
  before: ObjectiveDeck,
  after: ObjectiveDeck,
  ctx: ObjectiveContext
): boolean {
  const identity = new Set(ctx.colorIdentity);
  const split = (d: ObjectiveDeck) => {
    const lands = d.cards.filter(isLandCard);
    return buildManabaseSummary(
      lands,
      d.cards.filter((c) => !isLandCard(c)),
      identity
    );
  };
  const was = new Map(split(before).lines.map((l) => [l.color, l]));
  return split(after).lines.some((l) => l.short && l.sources < (was.get(l.color)?.sources ?? 0));
}

/**
 * The nonbasic count a land move leaves: basic-for-nonbasic only while under
 * customization.nonBasicLandCount, which the build chose and the invariant
 * checks. A nonbasic for a nonbasic never changes it.
 */
export function withinNonbasicCeiling(
  deck: ObjectiveDeck,
  move: { out: readonly number[]; in: readonly ScryfallCard[] },
  ctx: ObjectiveContext
): boolean {
  const ceiling = ctx.customization.nonBasicLandCount;
  if (ceiling === undefined) return true;
  const gain = move.in.filter((c) => !isBasicLand(c)).length;
  const loss = move.out.filter((i) => !isBasicLand(deck.cards[i])).length;
  return gain <= loss || nonbasicLands(deck) + gain - loss <= ceiling;
}
