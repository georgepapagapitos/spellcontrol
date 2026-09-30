/**
 * Shared synergy-axis overlap primitives (E20).
 *
 * Both the "similar cards" scorer (`similar-cards.ts`) and the intelligent cut
 * ranker (`intelligent-cuts.ts`) need to ask "how mechanically alike are these
 * two cards?" using the 23-axis oracle-text classifier. This module owns the one
 * implementation of that math so the two callers can't drift apart.
 *
 * A card's synergy footprint is the set of `axis:side` keys it produces or pays
 * off (e.g. `tokens:producer`, `sacrifice:payoff`). Overlap is the Jaccard index
 * of two such sets. Pure + isomorphic; lives in `src/lib/**` so it's coverage-gated.
 */
import { classifyCard } from '@/deck-builder/services/synergy/classify';
import { AXES, type AxisKey } from '@/deck-builder/services/synergy/axes';
import type { ScryfallCard } from '@/deck-builder/types';

const AXIS_LABELS = new Map<AxisKey, string>(AXES.map((a) => [a.key, a.label]));

/** The set of `axis:side` keys a card produces or pays off (its synergy footprint). */
export function axisKeys(card: ScryfallCard): Set<string> {
  const synergy = classifyCard(card);
  const keys = new Set<string>();
  for (const p of synergy.producers) keys.add(`${p.axis}:producer`);
  for (const o of synergy.payoffs) keys.add(`${o.axis}:payoff`);
  return keys;
}

/** Jaccard overlap (0–1) of two axis-key sets. 0 when either set is empty. */
export function axisJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const k of a) if (b.has(k)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Bare axis names (deduped, side-stripped) shared between two axis-key sets. */
export function sharedAxisNames(a: Set<string>, b: Set<string>): string[] {
  const out = new Set<string>();
  for (const key of a) {
    if (b.has(key)) out.add(key.split(':')[0]);
  }
  return [...out];
}

/** Short, human label for an axis key ("tokens" → "Tokens"), for reason chips. */
export function axisLabel(axis: string): string {
  const full = AXIS_LABELS.get(axis as AxisKey) ?? axis;
  // The registry labels are descriptive ("Tokens / go-wide"); keep just the head.
  return full.split(/[/(]/)[0].trim();
}
