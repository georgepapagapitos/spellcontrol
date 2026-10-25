import type { PodRule0Deck, PodRule0Signals } from './pods-client';

/**
 * Words for a pod's Rule 0 notes. The notes describe decks for the pregame
 * conversation. They never rank a table, name a threat or say what a pod
 * should do, so nothing here returns a verdict: a spread, and one neutral
 * pointer to the widest gap.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "one deck", "two decks", then digits. */
function decksPhrase(n: number): string {
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
  return `${words[n] ?? n} ${n === 1 ? 'deck' : 'decks'}`;
}

/** The signals worth saying out loud for one deck, in the order they matter. */
export function signalPhrases(s: PodRule0Signals): string[] {
  const out: string[] = [];
  if (s.gameChangers > 0) out.push(plural(s.gameChangers, 'Game Changer', 'Game Changers'));
  if (s.twoCardCombos > 0) out.push(plural(s.twoCardCombos, 'two-card combo', 'two-card combos'));
  if (s.multiCardCombos > 0) {
    out.push(plural(s.multiCardCombos, 'longer combo', 'longer combos'));
  }
  if (s.massLandDenial > 0) out.push('mass land denial');
  if (s.extraTurns > 0) out.push(plural(s.extraTurns, 'extra-turn card', 'extra-turn cards'));
  return out;
}

/**
 * One line about how the decks sit next to each other, e.g.
 * "Brackets 2 to 4; one deck has a two-card combo." Null with nothing to say.
 */
export function spreadLine(decks: readonly PodRule0Deck[]): string | null {
  if (decks.length === 0) return null;
  const rated = decks.filter((d) => d.bracket !== null);
  const parts: string[] = [];
  if (rated.length > 0) {
    const lo = Math.min(...rated.map((d) => d.bracket!));
    const hi = Math.max(...rated.map((d) => d.bracket!));
    parts.push(lo === hi ? `All Bracket ${lo}` : `Brackets ${lo} to ${hi}`);
  }
  const count = (pick: (s: PodRule0Signals) => number) =>
    decks.filter((d) => d.signals && pick(d.signals) > 0).length;
  const facts: Array<[number, string, string]> = [
    [count((s) => s.twoCardCombos), 'has a two-card combo', 'have a two-card combo'],
    [count((s) => s.massLandDenial), 'has mass land denial', 'have mass land denial'],
    [count((s) => s.extraTurns), 'runs extra turns', 'run extra turns'],
  ];
  for (const [n, one, many] of facts) {
    if (n > 0) parts.push(`${decksPhrase(n)} ${n === 1 ? one : many}`);
  }
  const unrated = decks.length - rated.length;
  if (unrated > 0) parts.push(`${decksPhrase(unrated)} not rated yet`);
  return parts.length === 0 ? null : `${parts.join('; ')}.`;
}

/**
 * The widest bracket gap, only when it is two or more brackets and sits between
 * decks of different owners (a gap inside one person's shelf is not a table
 * question). Neutral wording, no one named as the problem.
 */
export function widestGap(
  decks: readonly PodRule0Deck[]
): { low: PodRule0Deck; high: PodRule0Deck } | null {
  const rated = decks.filter((d) => d.bracket !== null);
  let best: { low: PodRule0Deck; high: PodRule0Deck } | null = null;
  for (const a of rated) {
    for (const b of rated) {
      if (a.userId === b.userId || a.bracket! >= b.bracket!) continue;
      const gap = b.bracket! - a.bracket!;
      if (gap >= 2 && (!best || gap > best.high.bracket! - best.low.bracket!)) {
        best = { low: a, high: b };
      }
    }
  }
  return best;
}

export function gapLine(gap: { low: PodRule0Deck; high: PodRule0Deck }): string {
  const who = (d: PodRule0Deck) => `${d.name} (${d.username}) at Bracket ${d.bracket}`;
  return `Widest gap: ${who(gap.low)} and ${who(gap.high)}.`;
}
