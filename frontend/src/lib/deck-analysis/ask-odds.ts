/**
 * Odds for the Test hand's "Ask your own" section: the chance of holding at
 * least N copies of a card or role group by turn T, exact (hypergeometric),
 * before any mulligan, plus which tutors in the deck can fetch a given card.
 */

/** The slice of a card these helpers read. A `ScryfallCard` fits. */
export interface OddsCard {
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ type_line?: string; oracle_text?: string }>;
}

const OPENING_HAND = 7;

function logChoose(n: number, k: number): number {
  let sum = 0;
  for (let i = 1; i <= k; i++) sum += Math.log((n - k + i) / i);
  return sum;
}

/** P(X >= atLeast) drawing `draws` cards from `population`, `successes` of them hits. */
export function hypergeometricAtLeast(
  population: number,
  successes: number,
  draws: number,
  atLeast: number
): number {
  const d = Math.min(Math.max(0, Math.floor(draws)), population);
  const k = Math.min(Math.max(0, Math.floor(successes)), population);
  if (atLeast <= 0) return 1;
  if (atLeast > k || atLeast > d) return 0;
  const total = logChoose(population, d);
  let p = 0;
  for (let i = atLeast; i <= Math.min(k, d); i++) {
    if (d - i > population - k) continue;
    p += Math.exp(logChoose(k, i) + logChoose(population - k, d - i) - total);
  }
  return Math.min(1, p);
}

/** Cards seen by the end of turn `turn`: the hand, plus a draw each turn (not on turn 1 on the play). */
export function cardsSeen(turn: number, onPlay: boolean): number {
  return OPENING_HAND + Math.max(0, turn - (onPlay ? 1 : 0));
}

export interface AskOdds {
  play: number;
  draw: number;
}

/** Odds of at least `atLeast` of `successes` hit cards in a `population`-card library by `turn`. */
export function askOdds(
  population: number,
  successes: number,
  atLeast: number,
  turn: number
): AskOdds {
  return {
    play: hypergeometricAtLeast(population, successes, cardsSeen(turn, true), atLeast),
    draw: hypergeometricAtLeast(population, successes, cardsSeen(turn, false), atLeast),
  };
}

const text = (card: OddsCard, field: 'type_line' | 'oracle_text'): string =>
  [card[field], ...(card.card_faces ?? []).map((f) => f[field])].filter(Boolean).join('\n');

const SEARCH = /search your library for (.*?) cards?\b(.*)/is;
const LEADING = /^(?:up to (?:one|two|three|four|x|\d+)|an?|one|two|three|x)(?:\s+|$)/;

function typeTokens(card: OddsCard): Set<string> {
  const tokens = new Set(
    text(card, 'type_line')
      .toLowerCase()
      .split(/[\s—\-/]+/)
      .filter(Boolean)
  );
  if (!tokens.has('instant') && !tokens.has('sorcery')) tokens.add('permanent');
  return tokens;
}

function altMatches(alt: string, target: Set<string>): boolean {
  const words = alt.split(/\s+/).filter(Boolean);
  return words.every((w) => {
    if (w.startsWith('non')) return !target.has(w.slice(3));
    return target.has(w) || target.has(w.replace(/s$/, ''));
  });
}

/**
 * Whether `tutor` can search the library for `target` and leave it in hand or
 * on top of the library, read from the tutor's oracle text. Searches that put
 * a card onto the battlefield (ramp, Chord of Calling) are not counted, and
 * mana value limits are not read.
 */
export function tutorFinds(tutor: OddsCard, target: OddsCard): boolean {
  if (tutor.name === target.name) return false;
  const oracle = text(tutor, 'oracle_text');
  const m = SEARCH.exec(oracle);
  if (!m) return false;
  const rest = m[2].split(/\.(?:\s|$)/)[0].toLowerCase();
  if (!/into your hand|on top of your library|put (?:that|the|it)[^,]* on top|on top\b/.test(rest))
    return false;
  const named = /^\s+named (.+?)(?:,|$)/.exec(m[2]);
  if (named) return named[1].trim().toLowerCase() === target.name.toLowerCase();
  const descriptor = m[1].toLowerCase().replace(LEADING, '').trim();
  if (!descriptor) return true;
  const tokens = typeTokens(target);
  return descriptor.split(/,\s*or\s+|,\s*|\s+or\s+/).some((alt) => altMatches(alt.trim(), tokens));
}

/** The tutors in `deck` that can fetch `target`, one entry per name. */
export function tutorsFor(deck: OddsCard[], target: OddsCard): OddsCard[] {
  const seen = new Set<string>();
  const out: OddsCard[] = [];
  for (const c of deck) {
    if (seen.has(c.name) || !tutorFinds(c, target)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
}
