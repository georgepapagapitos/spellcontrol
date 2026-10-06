/**
 * ONE protection set (E540 S3): the cards a move may not take out of a deck
 * (or may take only for a card as good), read by every path that cuts.
 *
 * The objective's own protections (a piece of a complete combo, a tutor that
 * finds one, a protection piece, a Game Changer, a staple, the commander's
 * signature cards: the E513 search's trust region, moved here unchanged) come
 * first. A context can add more through `extraProtections` (types.ts): Coach
 * fills it with the protections its cut paths keep (coachProtections.ts:
 * premium cards, what feeds the commander, the invested engines, finishers,
 * survival pieces, what Coach would suggest straight back). The default is
 * none, so generation and the search read exactly the set they always did.
 *
 * `protectedCards` is the whole set of a deck, for a loop; `protectionOf` asks
 * about one card. The trust region (trustRegion.ts) judges a move against it.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { frontFaceName, getByCardName } from '@/lib/cards/card-text';
import { normalizeCardName } from '../cardIdentity';
import { STAPLE_INCLUSION_BAR } from '../roleCapAllowance';
import { completeCombos } from './constraints';
import { isBasicLand, isLandCard } from './context';
import { protectionValue } from './terms/interaction';
import { readTutors } from './terms/tutors';
import {
  COACH_PROTECTED_CLASSES,
  type ObjectiveContext,
  type ObjectiveDeck,
  type Protection,
  type ProtectedClass,
} from './types';

export type { CoachProtectedClass, Protection, ProtectedClass } from './types';

/** The generator's staple bar (cardPicking.ts STAPLE_INCLUSION_BAR, E532): in this share (%) of the page's decks. */
export const STAPLE_BAR = STAPLE_INCLUSION_BAR;

export const isGameChanger = (c: ScryfallCard, ctx: ObjectiveContext) =>
  ctx.gameChangerNames.has(c.name) || ctx.gameChangerNames.has(c.name.split(' // ')[0]);

/** Classes that never leave outside a repair (Coach's own never leave either: its cut paths offer none of them). */
export const STRICT: ReadonlySet<ProtectedClass> = new Set([
  'combo piece',
  'near combo piece',
  'combo tutor',
  ...COACH_PROTECTED_CLASSES,
]);

/** A line of this many cards or more counts as a build-around once one card from complete. */
const NEAR_LINE_CARDS = 3;
/** A commander's signature cards: the page's most commander-specific few ... */
export const SIGNATURE_COUNT = 5;
/** ... among the cards a real share of its decks play (a 2% card with a big ratio is noise). */
export const SIGNATURE_MIN_PCT = 20;

const signatureCache = new WeakMap<ObjectiveContext['edhrec'], ReadonlySet<string>>();

/** The page's top SIGNATURE_COUNT cards by EDHREC synergy among those played in SIGNATURE_MIN_PCT of decks. */
function signatureNames(ctx: ObjectiveContext): ReadonlySet<string> {
  let names = signatureCache.get(ctx.edhrec);
  if (!names) {
    names = new Set(
      [...ctx.edhrec]
        .filter(([, r]) => r.inclusion >= SIGNATURE_MIN_PCT && (r.synergy ?? 0) > 0)
        .sort(([an, a], [bn, b]) => b.synergy! - a.synergy! || an.localeCompare(bn))
        .slice(0, SIGNATURE_COUNT)
        .map(([n]) => n)
    );
    signatureCache.set(ctx.edhrec, names);
  }
  return names;
}

export const synergyOf = (card: ScryfallCard, ctx: ObjectiveContext) =>
  getByCardName(ctx.edhrec, card.name)?.synergy ?? -Infinity;

/** The protected class of each card in a deck, by name. */
export function protectedCards(
  deck: ObjectiveDeck,
  ctx: ObjectiveContext,
  stapleBar = STAPLE_BAR
): Map<string, Protection> {
  const out = new Map<string, Protection>();
  // Every combo the deck completes, template lines included: the value terms
  // credit only the ones known to work (viableCombos), but a piece of a line
  // the deck may complete is no slot to spend (the gate's Umbral Mantle, a
  // piece of four lines).
  const combos = completeCombos(deck, ctx);
  for (const c of combos) {
    for (const n of c.cards) {
      const card = deck.cards.find((d) => d.name === n || d.name.split(' // ')[0] === n);
      if (card && !out.has(card.name)) {
        out.set(card.name, { cls: 'combo piece', why: `a piece of ${c.cards.join(' + ')}` });
      }
    }
  }
  // The pieces of a line of three or more that is one card from complete: the
  // deck is built toward it, and a piece cut sets it two away (Satoru Umezawa
  // in Yuriko's deck, a piece of four such lines, went for a two-card combo).
  const held = new Set(
    [...deck.commanders, ...deck.cards].flatMap((c) => [
      normalizeCardName(c.name),
      normalizeCardName(frontFaceName(c.name)),
    ])
  );
  for (const c of ctx.combos ?? []) {
    if (c.cards.length < NEAR_LINE_CARDS) continue;
    const have = (n: string) =>
      held.has(normalizeCardName(n)) || held.has(normalizeCardName(frontFaceName(n)));
    if (c.cards.filter((n) => !have(n)).length !== 1) continue;
    for (const n of c.cards.filter(have)) {
      const card = deck.cards.find((d) => d.name === n || frontFaceName(d.name) === n);
      if (card && !out.has(card.name)) {
        out.set(card.name, {
          cls: 'near combo piece',
          why: `a piece of ${c.cards.join(' + ')}, one card from complete`,
        });
      }
    }
  }
  for (const t of readTutors(deck, ctx)) {
    if (t.why.startsWith('a piece of') && !out.has(t.name)) {
      out.set(t.name, { cls: 'combo tutor', why: `the tutor that finds ${t.target}` });
    }
  }
  // What the context adds (Coach's protections). Before the soft classes below,
  // so a card Coach never cuts is not downgraded to "leaves for one as played".
  if (ctx.extraProtections) {
    for (const card of deck.cards) {
      if (out.has(card.name)) continue;
      const p = ctx.extraProtections(card, deck, ctx);
      if (p) out.set(card.name, p);
    }
  }
  for (const card of deck.cards) {
    if (out.has(card.name) || isBasicLand(card)) continue;
    const facts = ctx.factsOf(card);
    if (isLandCard(card)) {
      if (facts.interaction.length > 0) {
        out.set(card.name, { cls: 'interaction land', why: 'a land that is also interaction' });
      }
    } else if (protectionValue(card, facts) > 0) {
      out.set(card.name, { cls: 'protection', why: 'a protection piece' });
    }
  }
  for (const card of deck.cards) {
    if (out.has(card.name)) continue;
    if (
      ctx.gameChangerNames.has(card.name) ||
      ctx.gameChangerNames.has(card.name.split(' // ')[0])
    ) {
      out.set(card.name, { cls: 'Game Changer', why: 'a Game Changer' });
    }
  }
  for (const card of deck.cards) {
    // Basics swap only for basics, and their page rows say nothing about a slot.
    if (out.has(card.name) || isBasicLand(card)) continue;
    const pct = inclusionPct(card, ctx);
    if (pct >= stapleBar) {
      out.set(card.name, { cls: 'staple', why: `a staple (${Math.round(pct)}% of decks)` });
    }
  }
  // The commander's signature cards leave only for one as commander-specific,
  // or as played.
  const signature = signatureNames(ctx);
  for (const card of deck.cards) {
    if (out.has(card.name) || isBasicLand(card)) continue;
    const row = [...signature].find(
      (n) => getByCardName(ctx.edhrec, card.name) === ctx.edhrec.get(n)
    );
    if (row)
      out.set(card.name, { cls: 'signature', why: "one of this commander's signature cards" });
  }
  return out;
}

/**
 * The protection on one card of `deck`, or null: the same set `protectedCards`
 * builds, asked about a card. A card that is not in the deck holds none.
 */
export function protectionOf(
  card: ScryfallCard,
  deck: ObjectiveDeck,
  ctx: ObjectiveContext,
  stapleBar = STAPLE_BAR
): Protection | null {
  return protectedCards(deck, ctx, stapleBar).get(card.name) ?? null;
}

/** EDHREC inclusion on this page, in percent (0 off the page). */
export function inclusionPct(card: ScryfallCard, ctx: ObjectiveContext): number {
  return getByCardName(ctx.edhrec, card.name)?.inclusion ?? 0;
}
