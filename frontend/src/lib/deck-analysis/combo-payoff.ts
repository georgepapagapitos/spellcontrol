/**
 * Ranks a Spellbook combo by payoff *quality* rather than raw popularity
 * (E83). Popularity tells you what's commonly played, not whether the combo
 * is actually worth surfacing first — a combo that only draws a card is
 * "popular" because it's a piece of a bigger line, but on its own it's not
 * the payoff a player wants pushed to the top of a one-away list.
 *
 * Approach (tier ladder over the combo's `produces` result strings) borrowed
 * from Manafoundry's combo scoring: https://github.com/20q2/mtg-commander-deck-generator
 * (MIT licensed).
 *
 * Tiers (highest wins, except FORCED_DRAW which is absolute):
 *   WIN (5)          — wins the game outright, or eliminates all opponents.
 *                       e.g. "Win the game", "Each opponent loses the game"
 *   LETHAL (4)       — infinite damage / life loss / mill aimed at opponents.
 *                       e.g. "Infinite combat damage", "Infinite damage to any target",
 *                            "Mill each opponent's library"
 *   ENGINE (3)       — infinite mana / draw / tokens / ETBs / extra turns —
 *                       powerful, but needs a follow-up card to close the game.
 *                       e.g. "Infinite colorless mana", "Infinite card draw",
 *                            "Infinite tokens", "Near-infinite turns"
 *   VALUE (1)        — a real but modest payoff: lock pieces, lifegain, tutors.
 *                       e.g. "Lock the opponent out of their turn", "Gain infinite life"
 *   NEUTRAL (0)      — default for produces text that doesn't match any tier
 *                       (unknown/new Spellbook wording — treated as ordinary,
 *                       not penalized).
 *   FORCED_DRAW (-1) — a forced draw is an anti-wincon; ranked dead last.
 *                       e.g. "Draw the game", "The game ends in a draw"
 *                       Only applies when EVERY result is a forced draw — a
 *                       combo that also wins some other way isn't punished.
 */

export const PAYOFF_TIER = {
  WIN: 5,
  LETHAL: 4,
  ENGINE: 3,
  VALUE: 1,
  NEUTRAL: 0,
  FORCED_DRAW: -1,
} as const;

const FORCED_DRAW_RE = [/draws? the game/, /ends? in a draw/, /forc(?:e|es|ed) a draw/];

const WIN_RE = [
  /wins? the game/,
  /loses? the game/, // "X loses the game" / "each opponent loses the game"
  /eliminates? (?:all|every) opponents?/,
];

const LETHAL_RE = [
  /infinite.*damage/,
  /infinite.*(?:life ?loss|lose.*life)/,
  /damage.*infinite/,
  /mill.*opponent/,
  /opponent.*mill/,
  /deck(?:s)? (?:out |the )?opponent/,
];

const ENGINE_RE = [
  /infinite.*mana/,
  /infinite.*(?:draw|card)/,
  /draw.*infinite/,
  /infinite.*token/,
  /infinite.*(?:etb|enters? the battlefield)/,
  /(?:infinite|extra).*turns?/,
];

const VALUE_RE = [/\block\b/, /gain.*life/, /tutor/, /protect/];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => re.test(text));
}

/** Classifies a single `produces` result string into a payoff tier. */
export function classifyPayoffResult(result: string): number {
  const text = result.toLowerCase();
  if (matchesAny(FORCED_DRAW_RE, text)) return PAYOFF_TIER.FORCED_DRAW;
  if (matchesAny(WIN_RE, text)) return PAYOFF_TIER.WIN;
  if (matchesAny(LETHAL_RE, text)) return PAYOFF_TIER.LETHAL;
  if (matchesAny(ENGINE_RE, text)) return PAYOFF_TIER.ENGINE;
  if (matchesAny(VALUE_RE, text)) return PAYOFF_TIER.VALUE;
  return PAYOFF_TIER.NEUTRAL;
}

/**
 * Scores a combo's overall payoff as the MAX tier across all of its results
 * (a combo that wins outright AND makes infinite mana is still just "wins
 * the game"). The one exception: FORCED_DRAW is absolute — if every result
 * is a forced draw, the combo scores as a straight anti-wincon regardless of
 * anything else, since forcing a draw isn't a fallback payoff, it's the
 * combo's entire point.
 */
export function comboPayoffScore(results: string[]): number {
  if (results.length === 0) return PAYOFF_TIER.NEUTRAL;
  const tiers = results.map(classifyPayoffResult);
  if (tiers.every((t) => t === PAYOFF_TIER.FORCED_DRAW)) return PAYOFF_TIER.FORCED_DRAW;
  return Math.max(PAYOFF_TIER.NEUTRAL, ...tiers.filter((t) => t !== PAYOFF_TIER.FORCED_DRAW));
}
