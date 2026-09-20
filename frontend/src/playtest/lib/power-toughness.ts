import type { BattlefieldCard, PlaytestCard } from '@/lib/playtest';

/**
 * What the power/toughness box on a permanent should read.
 *
 * THREE things feed it and none is reliable alone: the printed values
 * (`PlaytestCard.power`/`toughness`, verbatim from Scryfall, so `*`, `1+*`
 * and `∞` all turn up), the running modifier the player applied by hand
 * (`BattlefieldCard.pt`), and the +1/+1 and -1/-1 counters ON the card.
 *
 * Counters count because a 2/2 under two +1/+1 counters is a 4/4, and that
 * is the number the player needs when they are working out whether it
 * survives. Reading the printed 2/2 and doing the arithmetic off the counter
 * badge is exactly the work a board should be doing for you. The badge stays
 * visible alongside, so the size and the reason for it are both on the card.
 *
 * Where the printed value is a plain number everything adds up and the box
 * shows one total, the way a player reading the board would say it. Where it
 * isn't — a Tarmogoyf, a token nobody typed a body into — the modifier is
 * shown BESIDE the printed value rather than folded into it, because `*+2`
 * is true and `2` would be a lie.
 *
 * Returns null when there is nothing to show at all, which is the common
 * case: a land, an artifact, an enchantment nobody has pumped.
 */
export interface PtDisplay {
  power: string;
  toughness: string;
  /** True when a hand-applied modifier is part of what's shown — the face
   *  tints the box so a pumped creature reads differently from a printed
   *  one at a glance. */
  modified: boolean;
}

function side(printed: string | undefined, delta: number): string | null {
  const base = printed?.trim();
  if (base === undefined || base === '') return delta === 0 ? null : signed(delta);
  const n = Number(base);
  if (Number.isFinite(n) && /^-?\d+$/.test(base)) return String(n + delta);
  return delta === 0 ? base : `${base}${signed(delta)}`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** The ±1/±1 counters on a permanent, as a single signed step. Only these
 *  two kinds change a body — a charge or a loyalty counter does not, and
 *  folding one in would print a size the card does not have. */
export function counterStep(bf: BattlefieldCard | undefined): number {
  const plus = bf?.counters?.['+1/+1'] ?? 0;
  const minus = bf?.counters?.['-1/-1'] ?? 0;
  return plus - minus;
}

export function displayPT(card: PlaytestCard, bf: BattlefieldCard | undefined): PtDisplay | null {
  const step = counterStep(bf);
  const dp = (bf?.pt?.power ?? 0) + step;
  const dt = (bf?.pt?.toughness ?? 0) + step;
  const power = side(card.power, dp);
  const toughness = side(card.toughness, dt);
  // A body needs both halves. One side alone (a printed power with no
  // toughness can't happen on a real card, but a hand-made token can be
  // anything) would render as half a box, so pad the missing side from the
  // modifier rather than dropping the whole badge.
  if (power === null && toughness === null) return null;
  return {
    power: power ?? signed(dp),
    toughness: toughness ?? signed(dt),
    modified: dp !== 0 || dt !== 0,
  };
}

/**
 * The number an in-place edit of one side counts up from: the printed value
 * where it is a plain integer, 0 where the card prints no body at all (a
 * hand-made token), and null where the printed value is something no total
 * can be typed against (`*`, `1+*`, `∞`) — those sides stay read-only on the
 * card and are stepped from the card menu instead.
 */
export function printedBase(printed: string | undefined): number | null {
  const base = printed?.trim();
  if (base === undefined || base === '') return 0;
  return /^-?\d+$/.test(base) ? Number(base) : null;
}
