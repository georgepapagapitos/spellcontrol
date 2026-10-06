/**
 * Class floors: the last answer of a kind, and the protection count, are not
 * the search's to spend (E513 round 2). The blind gate's Atraxa partial50
 * traded Counterspell, the deck's only stack interaction, for a third-choice
 * sweeper, and the report gained "No stack interaction"; its Lathril lost a
 * Swiftfoot Boots for an elf tutor. The score can't see a hole in coverage: a
 * card's answer value is judged alone, and a deck that has none of a class
 * loses nothing the score names.
 *
 * Classes are the answer-coverage matrix's own (answerCoverage.ts, the one
 * the coherence audit reports from), so the search and the report agree on
 * what a hole is:
 *  - an answer class the deck had (stack, graveyard, creature, artifact,
 *    enchantment, planeswalker) keeps at least one card of it;
 *  - protection (protectionValue, the reading the score and the report use)
 *    never falls below its count.
 * A swap that takes a card of a class must bring a card of the same class.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { classifyAnswer, type AnswerThreat } from '../answerCoverage';
import { isBasicLand, isLandCard } from './context';
import { protectionValue } from './terms/interaction';
import type { ObjectiveContext, ObjectiveDeck } from './types';

/** The classes counted: every threat the coverage matrix names, plus protection. */
export type FloorClass = Exclude<AnswerThreat, 'any-permanent'> | 'protection';

const BATTLEFIELD: readonly FloorClass[] = ['creature', 'artifact', 'enchantment', 'planeswalker'];

const answerCache = new Map<string, readonly AnswerThreat[]>();

/** The threats a card answers, as the coverage matrix reads its text (any permanent answers each battlefield class). */
function threatsOf(card: ScryfallCard): readonly AnswerThreat[] {
  let t = answerCache.get(card.name);
  if (!t) {
    t = classifyAnswer(card)?.answers.map((a) => a.threat) ?? [];
    answerCache.set(card.name, t);
  }
  return t;
}

/** The classes one card counts toward. */
export function classesOf(card: ScryfallCard, ctx: ObjectiveContext): FloorClass[] {
  if (isBasicLand(card)) return [];
  const out = new Set<FloorClass>();
  for (const threat of threatsOf(card)) {
    if (threat === 'any-permanent') BATTLEFIELD.forEach((c) => out.add(c));
    else out.add(threat);
  }
  if (!isLandCard(card) && protectionValue(card, ctx.factsOf(card)) > 0) out.add('protection');
  return [...out];
}

/** How many cards of each class the deck holds. */
export function classCounts(deck: ObjectiveDeck, ctx: ObjectiveContext): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of deck.cards)
    for (const cls of classesOf(card, ctx)) counts[cls] = (counts[cls] ?? 0) + 1;
  return counts;
}

/**
 * Why a move breaks a class floor, or null. `countsNow` is classCounts() of
 * the deck the move is made in.
 */
export function classFloorProblem(
  countsNow: Readonly<Record<string, number>>,
  outs: readonly ScryfallCard[],
  ins: readonly ScryfallCard[],
  ctx: ObjectiveContext
): string | null {
  const delta: Record<string, number> = {};
  for (const c of outs) for (const cls of classesOf(c, ctx)) delta[cls] = (delta[cls] ?? 0) - 1;
  for (const c of ins) for (const cls of classesOf(c, ctx)) delta[cls] = (delta[cls] ?? 0) + 1;
  for (const [cls, d] of Object.entries(delta)) {
    if (d >= 0) continue;
    const now = countsNow[cls] ?? 0;
    if (cls === 'protection') return `it would leave ${now + d} protection pieces of ${now}`;
    if (now > 0 && now + d <= 0) return `it is the deck's last ${cls} answer`;
  }
  return null;
}
