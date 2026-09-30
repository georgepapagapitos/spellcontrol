// E532: the dry run behind pickFromPrefetchedWithCurve's first tier, kept out
// of cardPicking.ts so that file stays under its size limit. See the tier's
// comment there for the ordering it builds.
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import { hasCurveRoom } from './curveUtils';

export interface DryRunInputs {
  /** The pass's own phases, in order, each with its type-check flag. */
  phases: [EDHRECCard[], boolean][];
  count: number;
  /** The checks that do not move while the pass runs (legality, identity,
   *  price cap, type, dependency gate). */
  eligible: (c: EDHRECCard, typeCheck: boolean) => boolean;
  cardMap: ReadonlyMap<string, ScryfallCard>;
  roleOf: (name: string) => RoleKey | undefined;
  /** target + tolerance per role, undefined when the role has no cap. */
  capOf: (role: RoleKey) => number | undefined;
  roleCounts: Record<RoleKey, number>;
  curveTargets: Record<number, number>;
  curveCounts: Record<number, number>;
  /** High synergy, a staple, or a live combo pick: may break the curve. */
  mayBreakCurve: (c: EDHRECCard) => boolean;
  /** Skips the role cap, as the real pass does for these names. */
  capExempt: (c: EDHRECCard) => boolean;
}

/**
 * What the pass would seat without the tier: its phases walked in order with
 * the role cap and the curve gate replayed on copies of the live counts.
 * Budget pacing is left out, which only matters under a deck budget, where
 * the tier is off.
 */
export function dryRunSeats(o: DryRunInputs): Set<string> {
  const roles = { ...o.roleCounts };
  const curve = { ...o.curveCounts };
  const seated = new Set<string>();
  for (const [cards, typeCheck] of o.phases) {
    for (const c of cards) {
      if (seated.size >= o.count) return seated;
      if (seated.has(c.name) || !o.eligible(c, typeCheck)) continue;
      const role = o.roleOf(c.name);
      const cap = role ? o.capOf(role) : undefined;
      if (role && cap !== undefined && (roles[role] ?? 0) >= cap && !o.capExempt(c)) continue;
      const card = o.cardMap.get(c.name);
      const cmc = Math.min(Math.floor(card?.cmc ?? 0), 7);
      if (!hasCurveRoom(cmc, o.curveTargets, curve) && !o.mayBreakCurve(c)) continue;
      seated.add(c.name);
      curve[cmc] = (curve[cmc] ?? 0) + 1;
      if (role) roles[role] = (roles[role] ?? 0) + 1;
    }
  }
  return seated;
}
