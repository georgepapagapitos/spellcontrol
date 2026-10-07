import type { ScryfallCard } from '@/deck-builder/types';
import type { PlanJudge } from './plan-move-judge';

/**
 * What "Fill the rest" adds to a part-built deck, given a full deck the
 * generator built around it.
 *
 * The generator is asked to keep every card already in the deck (as
 * `optimizeDeckCards` must-includes) and complete it. What comes back is a
 * whole deck, not a diff, and it can disagree with the one on screen:
 *
 * - It may leave out a card the deck already has (not legal, off-color). The
 *   player's card stays; one generated card has to give up its slot for it.
 * - It picks its own basic land count. A deck that already holds more basics
 *   than the generator wanted keeps them, so generated lands give way first.
 *
 * So the plan is the generated deck minus the current one (by name, per copy),
 * trimmed to exactly the open slots: surplus lands go first (basics before
 * nonbasics), then the least relevant spells. Nothing already in the deck is
 * ever removed.
 *
 * With a judge (E540 S9, the whole-deck objective) each addition is also
 * checked against the deck the additions before it leave: one the objective
 * scores as a loss, or that breaks a rule the deck holds, is left out and the
 * next generated card the trim set aside takes the slot. Fill adds only, so
 * the protection set has nothing to guard here: no card in the deck is cut.
 */
export interface FillPlan {
  /** Cards to add, one entry per copy: spells most relevant first, then lands. */
  additions: ScryfallCard[];
  /** Open slots left after the additions (the generator under-delivered, or the judge declined). */
  stillOpen: number;
  /** Generated cards the objective judged a loss for this deck, with its reason. */
  declined: { card: ScryfallCard; reason: string }[];
}

const frontType = (c: ScryfallCard) => (c.type_line ?? '').split('//')[0];
const isLand = (c: ScryfallCard) => /\bLand\b/.test(frontType(c));
const isBasic = (c: ScryfallCard) => /\bBasic\b/.test(frontType(c));

export function planFill(
  current: readonly ScryfallCard[],
  generated: readonly ScryfallCard[],
  target: number,
  relevancy: Readonly<Record<string, number>> = {},
  judge?: PlanJudge
): FillPlan {
  const open = target - current.length;
  if (open <= 0) return { additions: [], stillOpen: 0, declined: [] };

  const held = new Map<string, number>();
  for (const c of current) held.set(c.name, (held.get(c.name) ?? 0) + 1);
  const additions: ScryfallCard[] = [];
  for (const c of generated) {
    const n = held.get(c.name) ?? 0;
    if (n > 0) held.set(c.name, n - 1);
    else additions.push(c);
  }

  // Spells the trim set aside: the judge's stand-ins for a card it declines.
  const reserve: ScryfallCard[] = [];
  let overflow = additions.length - open;
  if (overflow > 0) {
    // Lands the finished deck would carry beyond what the generator planned.
    const landExcess =
      current.filter(isLand).length +
      additions.filter(isLand).length -
      generated.filter(isLand).length;
    const landCuts = [
      ...additions.filter((c) => isLand(c) && isBasic(c)),
      ...additions.filter((c) => isLand(c) && !isBasic(c)).reverse(),
    ].slice(0, Math.max(0, Math.min(landExcess, overflow)));
    for (const c of landCuts) additions.splice(additions.indexOf(c), 1);
    overflow -= landCuts.length;
  }
  if (overflow > 0) {
    const byValue = [...additions].sort(
      (a, b) => (relevancy[a.name] ?? 0) - (relevancy[b.name] ?? 0)
    );
    for (const c of byValue.slice(0, overflow)) {
      additions.splice(additions.indexOf(c), 1);
      reserve.push(c);
    }
  }

  const spells = additions
    .filter((c) => !isLand(c))
    .sort((a, b) => (relevancy[b.name] ?? 0) - (relevancy[a.name] ?? 0));
  const lands = additions.filter(isLand);
  if (!judge) {
    return {
      additions: [...spells, ...lands],
      stillOpen: Math.max(0, open - additions.length),
      declined: [],
    };
  }

  // The judge declines a card only when it is worse for the deck AND the slot can
  // be filled better. A premium card (a staple, Game Changer, combo piece, tutor,
  // survival piece) never leaves for a soft loss such as a role past its cap, and
  // a soft loss comes back when nothing better can take its slot: an open slot
  // is worse than a small loss. Only a hard rule break declines a premium card.
  const kept: ScryfallCard[] = [];
  const hard: { card: ScryfallCard; reason: string }[] = [];
  const soft: { card: ScryfallCard; reason: string }[] = [];
  const priorOf = () => kept.map((k) => ({ add: k.name, addCard: k, cut: null }));
  const consider = (c: ScryfallCard): void => {
    const v = judge.loss({ name: c.name, card: c }, priorOf());
    if (v.loss !== true) kept.push(c);
    else if (v.hard) hard.push({ card: c, reason: v.reason });
    else if (v.premium) kept.push(c);
    else soft.push({ card: c, reason: v.reason });
  };
  for (const c of [...spells, ...lands]) consider(c);
  // A rule that broke early (an owned share the later owned cards restore) is read again once the rest is in.
  const declined: FillPlan['declined'] = [];
  for (const h of hard.splice(0)) {
    const v = judge.loss({ name: h.card.name, card: h.card }, priorOf());
    if (v.loss === true && v.hard) declined.push(h);
    else if (v.loss === true && !v.premium) soft.push({ card: h.card, reason: v.reason });
    else kept.push(h.card);
  }
  const byRelevancy = (a: ScryfallCard, b: ScryfallCard) =>
    (relevancy[b.name] ?? 0) - (relevancy[a.name] ?? 0);
  // The generator's next-best spells take the slots the declined cards leave.
  for (const c of reserve.filter((r) => !isLand(r)).sort(byRelevancy)) {
    if (kept.length >= open) break;
    const v = judge.loss({ name: c.name, card: c }, priorOf());
    if (v.loss !== true || (v.premium && !v.hard)) kept.push(c);
  }
  // Nothing better for a slot: the soft loss stays rather than leave it empty.
  soft.sort((a, b) => byRelevancy(a.card, b.card));
  for (const s of soft) {
    if (kept.length < open) kept.push(s.card);
    else declined.push(s);
  }
  return {
    additions: [...kept.filter((c) => !isLand(c)), ...kept.filter(isLand)],
    stillOpen: Math.max(0, open - kept.length),
    declined,
  };
}
