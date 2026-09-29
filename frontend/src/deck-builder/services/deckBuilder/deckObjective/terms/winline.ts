/**
 * Win lines: how soon does the deck have a way to END the game in hand and
 * paid for? Read with the tools the Power tab uses, so the two agree:
 *
 * - the finishing lines: every complete win combo `detectWinConditions`
 *   (services/winConditions/detect.ts) reads off the context's combo set (all
 *   pieces must be drawn and cast), and one line made of the deck's
 *   finishers, any single one of which will do: the detector's alt-win cards
 *   (Thassa's Oracle, Laboratory Maniac) plus every card whose card facts give
 *   it a counted `finisher` role (Craterhoof Behemoth's overrun, Gray
 *   Merchant's drain, extra combats, mass steals);
 * - `simulateAssemblyClock` (lib/opening-hand-sim.ts) times them together:
 *   the share of goldfish games with ANY line online by each turn, tutors
 *   counting as wildcards.
 *
 *   value = WIN_SCALE × mean share online over turns 1..WIN_HORIZON
 *
 * Win combos are lines only where the target bracket allows combos (above 3),
 * the combos term's rule.
 *
 * More finishers come online sooner, a lost finisher later, and cutting the
 * ONLY one drops the line entirely. A deck with no finishing line reads 0 when
 * the detector still finds a plan (combat, go-wide, aristocrats: they win
 * through the other terms' cards), and −NO_WIN when it finds nothing at all.
 *
 * The detector's strategic paths are deliberately not timed here: their
 * "assembly" is a critical mass drawn (any two equipment for voltron), not a
 * kill, so a timed voltron path rewarded a second Lightning Greaves.
 */
import type { DetectedCombo, ScryfallCard } from '@/deck-builder/types';
import { countsAsRole } from '@/deck-builder/services/cardFacts';
import { detectWinConditions } from '@/deck-builder/services/winConditions/detect';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { simulateAssemblyClock, type ClockCard } from '@/lib/mana-sim/opening-hand-sim';
import type { CardNote, ObjectiveContext, ObjectiveDeck } from '../types';
import { alignToSlots } from './mana';
import { deckNameKeys, nameKeys, nonLandCards, pct, type TermFn } from './shared';

/** A line online on every turn is worth what the combos term pays a first complete combo. */
export const WIN_SCALE = 2;
export const WIN_HORIZON = 12;
export const NO_WIN = 2;
/** Clock games: the mean share's standard error is about a point. */
export const CLOCK_GAMES = 1000;

/** Complete combos in the deck, in the detector's input shape. */
function combosInDeck(deck: ObjectiveDeck, combos: readonly DetectedCombo[]) {
  const keys = deckNameKeys(deck);
  return combos
    .filter(
      (c) => c.cards.length >= 2 && c.cards.every((n) => nameKeys(n).some((k) => keys.has(k)))
    )
    .map((c) => ({ results: c.results, cards: c.cards }));
}

export interface WinLines {
  /** Assembly options: one per complete win combo, plus any-one-finisher. */
  options: Array<{ names: string[]; need: number }>;
  combos: string[][];
  finishers: string[];
  tutors: string[];
  /** The detector found some plan (combat included). */
  anyPlan: boolean;
}

/** The deck's finishing lines. */
export function winLines(deck: ObjectiveDeck, ctx: ObjectiveContext): WinLines {
  const spells = nonLandCards(deck);
  const all = [...deck.commanders, ...spells];
  const analysis = detectWinConditions({
    cards: all,
    commander: deck.commanders[0] ?? null,
    partnerCommander: deck.commanders[1] ?? null,
    combosInDeck: combosInDeck(deck, ctx.combos ?? []),
    deckSynergy: analyzeDeckSynergy(all),
    format: 'commander',
  });
  const paths = analysis.primary ? [analysis.primary, ...analysis.secondary] : [];
  const comboPath = paths.find((p) => p.category === 'infinite-combo');
  const altWin = paths.find((p) => p.category === 'alt-win')?.evidence ?? [];
  const commanderNames = new Set(deck.commanders.map((c) => c.name));
  const finisherRole = (c: ScryfallCard) =>
    ctx.factsOf(c).roles.some((r) => r.role === 'finisher' && countsAsRole(r));
  const finishers = [
    ...new Set([...altWin, ...all.filter(finisherRole).map((c) => c.name)]),
  ].sort();
  // Win combos count only where the target bracket allows them, exactly as
  // the combos term rules: at bracket 3 or lower a combo is a liability.
  const target = ctx.customization.targetBracket;
  const combosAllowed = !(typeof target === 'number' && target <= 3);
  const comboOptions = combosAllowed ? (comboPath?.assembly ?? []) : [];
  const options = [...comboOptions];
  const drawable = finishers.filter((n) => !commanderNames.has(n));
  // A finisher in the command zone is always there: a zero-need line.
  if (finishers.some((n) => commanderNames.has(n))) options.push({ names: [], need: 0 });
  else if (drawable.length) options.push({ names: drawable, need: 1 });
  return {
    options,
    combos: comboOptions.map((o) => o.names),
    finishers,
    tutors: analysis.tutors ?? [],
    anyPlan: !analysis.noClearWinCondition,
  };
}

export const winlineTerm: TermFn = (deck, ctx) => {
  const lines = winLines(deck, ctx);
  if (lines.options.length === 0) {
    if (lines.anyPlan) {
      return { value: 0, summary: 'no finisher or win combo; the plan wins on board', cards: [] };
    }
    return {
      value: -NO_WIN,
      summary: 'no clear way to win',
      cards: [{ name: '(no win path)', value: -NO_WIN, note: 'nothing in the deck ends the game' }],
    };
  }
  const toClock = (c: ScryfallCard): ClockCard => ({ ...ctx.manaCardOf(c).sim, name: c.name });
  const library = (ctx.slotOrder ? alignToSlots(deck.cards, ctx.slotOrder) : deck.cards).map(
    toClock
  );
  const clock = simulateAssemblyClock(library, lines.options, {
    iterations: CLOCK_GAMES,
    seed: ctx.sim.seed,
    wildcards: lines.tutors,
  });
  let area = 0;
  for (let t = 1; t <= WIN_HORIZON; t++) area += clock?.assembledBy[t] ?? 0;
  const speed = area / WIN_HORIZON;
  const value = WIN_SCALE * speed;
  // Credit shared by every card in a line: finishers, then each combo's pieces.
  const pieces = [...new Set([...lines.finishers, ...lines.combos.flat()])];
  const notes: CardNote[] = pieces.map((name) => ({
    name,
    value: value / pieces.length,
    note: lines.finishers.includes(name)
      ? `finisher: a line is online ${pct(speed)} of turns 1-${WIN_HORIZON}`
      : `win-combo piece: a line is online ${pct(speed)} of turns 1-${WIN_HORIZON}`,
  }));
  return {
    value,
    summary: `${lines.finishers.length} finishers, ${lines.combos.length} win combos: a line is online ${pct(speed)} of turns 1-${WIN_HORIZON}`,
    cards: notes,
  };
};
