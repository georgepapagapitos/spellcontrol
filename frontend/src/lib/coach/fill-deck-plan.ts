import type { ScryfallCard } from '@/deck-builder/types';

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
 */
export interface FillPlan {
  /** Cards to add, one entry per copy: spells most relevant first, then lands. */
  additions: ScryfallCard[];
  /** Open slots left after the additions (the generator under-delivered). */
  stillOpen: number;
}

const frontType = (c: ScryfallCard) => (c.type_line ?? '').split('//')[0];
const isLand = (c: ScryfallCard) => /\bLand\b/.test(frontType(c));
const isBasic = (c: ScryfallCard) => /\bBasic\b/.test(frontType(c));

export function planFill(
  current: readonly ScryfallCard[],
  generated: readonly ScryfallCard[],
  target: number,
  relevancy: Readonly<Record<string, number>> = {}
): FillPlan {
  const open = target - current.length;
  if (open <= 0) return { additions: [], stillOpen: 0 };

  const held = new Map<string, number>();
  for (const c of current) held.set(c.name, (held.get(c.name) ?? 0) + 1);
  const additions: ScryfallCard[] = [];
  for (const c of generated) {
    const n = held.get(c.name) ?? 0;
    if (n > 0) held.set(c.name, n - 1);
    else additions.push(c);
  }

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
    for (const c of byValue.slice(0, overflow)) additions.splice(additions.indexOf(c), 1);
  }

  const spells = additions
    .filter((c) => !isLand(c))
    .sort((a, b) => (relevancy[b.name] ?? 0) - (relevancy[a.name] ?? 0));
  const lands = additions.filter(isLand);
  return { additions: [...spells, ...lands], stillOpen: Math.max(0, open - additions.length) };
}
