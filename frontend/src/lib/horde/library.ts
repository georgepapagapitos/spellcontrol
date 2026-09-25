import type { PlaytestCard } from '@/lib/playtest';
import { mulberry32, nextSeed, shuffle } from '@/lib/playtest/rng';
import type { HordeSettings } from './settings';

/** An authored horde deck (PR 2 supplies the real decks). */
export interface HordeDeckDef {
  id: string;
  name: string;
  specialRule: string;
  /** One entry per copy, already `isToken: true`. */
  tokens: PlaytestCard[];
  /** Nontoken cards, one entry per copy. */
  spells: PlaytestCard[];
  /** Held out of the library entirely — dealt in on a boss tick. */
  bosses: PlaytestCard[];
  /** Card NAMES (from `spells`) never dealt into the safe zone. */
  lateGame: string[];
  /**
   * A hash of the deck's source data. An online table stores the host's
   * `rev` at Start; a device whose deck differs (another app version) would
   * rebuild a different horde from the same seed, so it must not replay.
   */
  rev: string;
}

/** Fraction of the library that is safe-zone (no late game, tokens spread
 *  evenly) for each `SafeZone` setting. 'off' does no safe-zone dealing. */
const SAFE_ZONE_FRACTION: Record<HordeSettings['safeZone'], number> = {
  full: 0.2,
  reduced: 0.13,
  off: 0,
};

/** Repeats (or truncates) `items` to exactly `count` entries, cycling from
 *  the front — this is both "cut" (count <= items.length, a plain slice)
 *  and "extend by repeating" (count > items.length) in one pass. */
export function takeCycled<T>(items: readonly T[], count: number): T[] {
  if (items.length === 0 || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => items[i % items.length]);
}

/** How many tokens vs spells the final library gets: proportional to the
 *  authored ratio when cutting down; when the requested size is bigger than
 *  the authored deck, every spell is kept and only tokens are repeated to
 *  fill the rest (falls back to repeating spells if the deck has none). */
export function targetCounts(
  tokensLen: number,
  spellsLen: number,
  librarySize: number
): { tokenCount: number; spellCount: number } {
  const total = tokensLen + spellsLen;
  const size = Math.max(0, librarySize);
  if (total === 0 || size === 0) return { tokenCount: 0, spellCount: 0 };
  if (size <= total) {
    const tokenCount = Math.min(tokensLen, Math.round((tokensLen / total) * size));
    return { tokenCount, spellCount: size - tokenCount };
  }
  if (tokensLen === 0) return { tokenCount: 0, spellCount: size };
  return { tokenCount: size - spellsLen, spellCount: spellsLen };
}

/** Spreads `tokens` evenly through `nontokens` by giving each token its own
 *  evenly-spaced slot in the combined timeline (slot `k` centers on
 *  `(k + 0.5) / tokens.length` of the way through), rather than clumping
 *  them at one end. Ponytail: when tokens outnumber nontokens the slots can
 *  collide, so the overflow lands after the nontokens run out — good enough
 *  for a horde reveal window; revisit if a deck ships with more tokens than
 *  nontoken cards in its safe zone. */
export function interleaveEvenly(
  nontokens: PlaytestCard[],
  tokens: PlaytestCard[]
): PlaytestCard[] {
  if (tokens.length === 0) return nontokens;
  if (nontokens.length === 0) return tokens;
  const total = nontokens.length + tokens.length;
  const tokenSlots = new Set(tokens.map((_, i) => Math.floor((i + 0.5) * (total / tokens.length))));
  const out: PlaytestCard[] = [];
  let ni = 0;
  let ti = 0;
  for (let i = 0; i < total; i++) {
    if (tokenSlots.has(i) && ti < tokens.length) {
      out.push(tokens[ti++]);
    } else if (ni < nontokens.length) {
      out.push(nontokens[ni++]);
    } else {
      out.push(tokens[ti++]);
    }
  }
  return out;
}

/** Reorders `pool` so its first `fraction` contains no `lateGame`-named
 *  card, with tokens spread evenly among the nontoken cards in that window.
 *  Everything after keeps its shuffled relative order. */
export function dealSafeZone(
  pool: PlaytestCard[],
  lateGame: readonly string[],
  fraction: number
): PlaytestCard[] {
  const size = Math.round(pool.length * fraction);
  if (size <= 0) return pool;
  const lateSet = new Set(lateGame);
  const eligible = pool.filter((c) => !lateSet.has(c.name));
  const safeCards = eligible.slice(0, Math.min(size, eligible.length));
  const safeSet = new Set(safeCards);
  const remainder = pool.filter((c) => !safeSet.has(c));
  const tokens = safeCards.filter((c) => c.isToken);
  const nontokens = safeCards.filter((c) => !c.isToken);
  return [...interleaveEvenly(nontokens, tokens), ...remainder];
}

/**
 * Build one game's library from an authored deck: cut/extend to
 * `settings.librarySize` keeping the token:spell ratio, shuffle with `seed`,
 * then deal the safe zone. Bosses are never included — they're returned
 * separately, dealt in on a boss tick. Every returned card gets a fresh
 * unique id (the reducer needs unique ids per instance); index 0 is the top
 * of the library.
 */
export function buildHordeLibrary(
  def: HordeDeckDef,
  settings: HordeSettings,
  seed: number
): { library: PlaytestCard[]; bosses: PlaytestCard[]; seed: number } {
  const { tokenCount, spellCount } = targetCounts(
    def.tokens.length,
    def.spells.length,
    settings.librarySize
  );
  const pool = [...takeCycled(def.tokens, tokenCount), ...takeCycled(def.spells, spellCount)];

  let s = seed >>> 0;
  const shuffled = shuffle(pool, mulberry32(s));
  s = nextSeed(s);

  const fraction = SAFE_ZONE_FRACTION[settings.safeZone];
  const ordered = fraction > 0 ? dealSafeZone(shuffled, def.lateGame, fraction) : shuffled;

  const library = ordered.map((card, i) => ({ ...card, id: `horde-lib-${i}-${card.id}` }));
  const bosses = def.bosses.map((card, i) => ({ ...card, id: `horde-boss-${i}-${card.id}` }));
  return { library, bosses, seed: s };
}
