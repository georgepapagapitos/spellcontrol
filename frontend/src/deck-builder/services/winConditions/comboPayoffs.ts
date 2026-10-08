/**
 * Deck payoffs that turn a Spellbook loop into a win (E578).
 *
 * `comboEndsGame` (detect.ts) reads a line's listed results alone, so Staff of
 * Domination + Priest of Titania ("Infinite untap of creatures you control",
 * infinite mana, draw, lifegain) reads as non-winning. In a Lathril, Blade of
 * the Elves deck the untaps let Lathril's own ability (tap ten Elves: each
 * opponent loses 10 life) repeat, which ends the game. Spellbook can't list
 * that line: Lathril is the deck's, not the combo's.
 *
 * So a deck is read for the cards that convert each kind of loop, off the card
 * facts' ability tuples (cost atoms + effects), not a name list:
 *
 *   untap  a creature whose repeatable ability costs only {T} and drains,
 *          damages or makes tokens (Lathril, Prodigal Pyromancer class)
 *   mana   a mana sink that wins: an activated ability, or an X spell, that
 *          damages or drains (Banefire, Fireball class), or the Walking
 *          Ballista shape (mana adds counters, counters become damage)
 *   etb    a creature-enters trigger that damages or drains (Impact
 *          Tremors, Purphoros)
 *   death  a creature-dies trigger that drains (Blood Artist, Zulaport)
 *
 * Infinite draw and lifegain are deliberately not converted here: Spellbook
 * already lists a draw loop with Thassa's Oracle / Laboratory Maniac as its own
 * "Win the game" line, which passes `comboEndsGame` by itself, so converting it
 * again would count one win twice.
 *
 * Pure + isomorphic. Facts missing (the snapshot not loaded, a card it lacks)
 * read as no payoff, which is the old behavior.
 */
import { getCardFacts, type AbilityFact, type CardFacts } from '../cardFacts';

export type PayoffKind = 'untap' | 'mana' | 'etb' | 'death';
export type DeckPayoffs = ReadonlySet<PayoffKind>;

export const NO_PAYOFFS: DeckPayoffs = new Set();

type Effect = AbilityFact['effects'][number];

/** Hurts an opponent: drain, or damage a player the controller can aim at them. */
function hurtsOpponent(e: Effect): boolean {
  if (e.verb === 'win') return true;
  if (e.verb === 'lose-life') return e.who === 'opp';
  return e.verb === 'damage' && e.object.includes('player') && (e.who === 'opp' || e.who === 'any');
}

function makesCreatureTokens(e: Effect): boolean {
  return e.verb === 'token' && e.object.startsWith('creature');
}

function kindsOf(f: CardFacts): DeckPayoffs {
  const kinds = new Set<PayoffKind>();
  const isCreature = f.types.includes('creature');
  const damagesViaCounters = f.abilities.some(
    (a) =>
      a.cost.includes('remove-counter') &&
      a.effects.some((e) => e.verb === 'damage' && hurtsOpponent(e))
  );
  for (const a of f.abilities) {
    if (a.kind === 'activated' && a.repeat !== 'once') {
      const costs = new Set(a.cost);
      if (isCreature && [...costs].every((c) => c === 'tap')) {
        if (a.effects.some((e) => hurtsOpponent(e) || makesCreatureTokens(e))) kinds.add('untap');
      }
      if ([...costs].every((c) => c === 'mana') && costs.size > 0) {
        if (a.effects.some((e) => hurtsOpponent(e) || makesCreatureTokens(e))) kinds.add('mana');
        if (
          damagesViaCounters &&
          a.effects.some((e) => e.verb === 'put-counter' && e.who === 'self')
        )
          kinds.add('mana');
      }
    }
    // An X spell takes all the mana the loop makes.
    if (a.kind === 'spell' && a.effects.some((e) => e.amount === 'X' && hurtsOpponent(e)))
      kinds.add('mana');
    if (a.kind === 'trigger' || a.kind === 'etb') {
      const t = a.trigger;
      if (!t || !a.effects.some(hurtsOpponent)) continue;
      if (t.event === 'enters' && t.object.startsWith('creature') && t.who !== 'opp')
        kinds.add('etb');
      if (t.event === 'dies' && t.object.startsWith('creature') && t.who !== 'opp')
        kinds.add('death');
    }
  }
  return kinds;
}

const memo = new WeakMap<CardFacts, DeckPayoffs>();

/** The loops one card converts into a win. */
export function cardPayoffs(f: CardFacts): DeckPayoffs {
  let hit = memo.get(f);
  if (!hit) {
    hit = kindsOf(f);
    memo.set(f, hit);
  }
  return hit;
}

/**
 * The loops a deck converts, commander included. `factsOf` defaults to the
 * loaded snapshot; the objective passes its context's reader.
 */
export function deckComboPayoffs<C extends { name: string; oracle_id?: string }>(
  cards: Iterable<C>,
  factsOf: (card: C) => CardFacts | undefined = getCardFacts
): DeckPayoffs {
  const out = new Set<PayoffKind>();
  for (const c of cards) {
    const f = factsOf(c);
    if (f) for (const k of cardPayoffs(f)) out.add(k);
  }
  return out;
}

// Spellbook's own labels (audited 2026-09, see detect.ts comboBucket).
const LOOP_LABELS: Array<[PayoffKind, RegExp]> = [
  ['untap', /\binfinite (?:[\w/+-]+ )*untaps?\b/i],
  ['mana', /\binfinite (?:[\w/+-]+ )*mana\b/i],
  ['etb', /\binfinite (?:[\w/+-]+ )*(?:etbs?|enters?|entering)\b/i],
  ['death', /\binfinite (?:[\w/+-]+ )*(?:death|dies|dying|deaths|sacrifices?)\b/i],
];

/** Does a payoff the deck holds convert one of this line's loops? */
export function loopConverts(results: string[], payoffs: DeckPayoffs): boolean {
  if (payoffs.size === 0) return false;
  return LOOP_LABELS.some(([kind, re]) => payoffs.has(kind) && results.some((l) => re.test(l)));
}
