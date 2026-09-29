// Role-cap overflow disclosure, moved out of deckGenerator.ts (E532) to keep
// that file under its size ceiling. deckGenerator.ts re-exports it.
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import { STAPLE_INCLUSION_BAR } from '../cardPicking';

const ROLE_DISPLAY: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipe',
  cardDraw: 'card draw',
};

/**
 * Disclosure for the role-cap escape hatch (E77 iter-4) — every gated path
 * (pick loop, Scryfall fallback, shortage backfill, owned substitutes)
 * increments the same shared counter when it admits an over-cap card rather
 * than shipping the deck short. Mirrors the `buildDisclosureNote` idiom in
 * phaseLiftPicks.ts: one terse note naming the total and the dominant role,
 * not per-card spam. Undefined when the hatch never actually fired.
 *
 * Deliberately narrow (round 3 fix): this counts ONLY escape-hatch
 * admissions, not the deck's total role overshoot — exempt picks
 * (must-includes, combo floor) and in-tolerance amounts can push a role's
 * final count well past this number, and `roleExcesses` (Overbuilt roles)
 * is the full accounting for that. Wording must never read as "the total is
 * N" when Overbuilt roles can show a larger one for the same role.
 * `stapleCounts` (E532) are staples the pick loop never holds back.
 */
export function buildRoleCapOverflowNote(
  counts: Partial<Record<RoleKey, number>>,
  stapleCounts: Partial<Record<RoleKey, number>> = {}
): string | undefined {
  const entries = (Object.entries(counts) as [RoleKey, number][]).filter(([, n]) => n > 0);
  const thin = entries.reduce((s, [, n]) => s + n, 0);
  const staples = Object.values(stapleCounts).reduce((s: number, n) => s + (n ?? 0), 0);
  const total = thin + staples;
  if (total === 0) return undefined;
  const [dominantRole] = entries.sort((a, b) => b[1] - a[1]);
  const thinClause = thin > 0 ? ` The ${ROLE_DISPLAY[dominantRole[0]]} pool was thin.` : '';
  const allStaples = total === 1 ? "It's" : "They're";
  const who = staples === total ? allStaples : `${staples} ${staples === 1 ? 'is' : 'are'}`;
  const stapleClause =
    staples > 0 ? ` ${who} in ${STAPLE_INCLUSION_BAR}% or more of this commander's decks.` : '';
  return `${total} card${total === 1 ? '' : 's'} went past a role cap.${thinClause}${stapleClause} See Overbuilt roles for the total.`;
}
