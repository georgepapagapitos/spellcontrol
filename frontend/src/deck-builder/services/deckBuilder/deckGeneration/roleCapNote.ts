// Role-cap overflow disclosure, moved out of deckGenerator.ts (E532) to keep
// that file under its size ceiling. deckGenerator.ts re-exports it.
import type { RoleKey } from '@/deck-builder/services/tagger/client';
import { STAPLE_INCLUSION_BAR } from '../cardPicking';
import { isRoleExcess } from '../deckAnalyzer';
import { countedRoleOf } from '../commanderDeckAnalysis';
import { passesRoleCap, roleCapLimit } from '../roleCapAllowance';
import { frontFaceName } from '@/lib/cards/card-text';
import type { ScryfallCard } from '@/deck-builder/types';

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
 * `stapleCounts` and `comboCounts` (E532) are staples and combo-line pieces
 * the pick loop let past a cap.
 */
export function buildRoleCapOverflowNote(
  counts: Partial<Record<RoleKey, number>>,
  stapleCounts: Partial<Record<RoleKey, number>> = {},
  comboCounts: Partial<Record<RoleKey, number>> = {},
  requiredCounts: Partial<Record<RoleKey, number>> = {}
): string | undefined {
  const sum = (c: Partial<Record<RoleKey, number>>) =>
    Object.values(c).reduce((s: number, n) => s + (n ?? 0), 0);
  const entries = (Object.entries(counts) as [RoleKey, number][]).filter(([, n]) => n > 0);
  const thin = sum(counts);
  const staples = sum(stapleCounts);
  const combos = sum(comboCounts);
  const required = sum(requiredCounts);
  const total = thin + staples + combos + required;
  if (total === 0) return undefined;
  const [dominantRole] = entries.sort((a, b) => b[1] - a[1]);
  const thinClause = thin > 0 ? ` The ${ROLE_DISPLAY[dominantRole[0]]} pool was thin.` : '';
  const subject = (n: number) =>
    n === total ? (total === 1 ? "It's" : "They're") : `${n} ${n === 1 ? 'is' : 'are'}`;
  const stapleClause =
    staples > 0
      ? ` ${subject(staples)} in ${STAPLE_INCLUSION_BAR}% or more of this commander's decks.`
      : '';
  const comboClause =
    combos > 0 ? ` ${subject(combos)} part of a combo the deck can assemble.` : '';
  const requiredClause =
    required > 0
      ? ` ${subject(required)} ${required === 1 ? 'a card' : 'cards'} you required.`
      : '';
  return `${total} card${total === 1 ? '' : 's'} went past a role cap.${thinClause}${stapleClause}${comboClause}${requiredClause} See Overbuilt roles for the total.`;
}

const POINTER = / See Overbuilt roles for the total\.$/;

/**
 * The note without its "See Overbuilt roles" pointer when the FINAL counts
 * leave nothing for it to point at (the report's `roleExcesses` is empty: a
 * role-surplus rebalance or the whole-deck search brought every role under the
 * excess bar after the escape hatch fired). The deck's own copy of the note and
 * the report's must agree, so both go through here with the final role counts.
 */
export function withoutDanglingPointer(
  note: string | undefined,
  roleTargets: Readonly<Record<string, number>> | undefined,
  roleCounts: Readonly<Record<string, number>> | undefined
): string | undefined {
  if (!note || !roleTargets) return note;
  const excess = Object.entries(roleTargets).some(([role, want]) =>
    isRoleExcess(roleCounts?.[role] ?? 0, want)
  );
  return excess ? note : note.replace(POINTER, '');
}

/**
 * The overflow note read off the FINAL deck (E499), not the pick-time tallies.
 * Those count escape-hatch admissions as they happen: cards a later phase
 * evicted still counted, cards a later phase seated past the cap never did,
 * and the role came from the picker's tag rather than countedRoleOf. This
 * counts what shipped, per role, with the one role source the report's
 * roleCounts reads (countedRoleOf) against the one cap the picker reads
 * (roleCapLimit). Each role's cards past the cap are explained combo piece
 * first, then staple, then a card the user required; the rest are the thin
 * pool. Report only: the pick-time tallies still gate the picker.
 */
export function buildFinalRoleCapOverflowNote(
  roleTargets: Readonly<Record<string, number>> | undefined,
  cards: readonly ScryfallCard[],
  inclusionOf: (name: string) => number,
  comboCardNames: ReadonlySet<string>
): string | undefined {
  if (!roleTargets) return undefined;
  const thin: Partial<Record<RoleKey, number>> = {};
  const staple: Partial<Record<RoleKey, number>> = {};
  const combo: Partial<Record<RoleKey, number>> = {};
  const required: Partial<Record<RoleKey, number>> = {};
  for (const role of Object.keys(ROLE_DISPLAY) as RoleKey[]) {
    const target = roleTargets[role];
    if (target == null) continue;
    const seated = cards.filter((c) => countedRoleOf(c) === role);
    let excess = seated.length - roleCapLimit(target);
    if (excess <= 0) continue;
    const take = (n: number) => {
      const used = Math.min(excess, n);
      excess -= used;
      return used;
    };
    const rest = seated.filter((c) => !c.isMustInclude);
    const isCombo = (c: ScryfallCard) => comboCardNames.has(frontFaceName(c.name).toLowerCase());
    const comboN = take(rest.filter(isCombo).length);
    const stapleN = take(
      rest.filter((c) => !isCombo(c) && passesRoleCap(inclusionOf(c.name), false)).length
    );
    const requiredN = take(seated.length - rest.length);
    if (comboN) combo[role] = comboN;
    if (stapleN) staple[role] = stapleN;
    if (requiredN) required[role] = requiredN;
    if (excess > 0) thin[role] = excess;
  }
  // This is the full count, so the "see Overbuilt roles for the total" pointer
  // (which exists because the pick-time tally is not) would only mislead.
  return buildRoleCapOverflowNote(thin, staple, combo, required)?.replace(POINTER, '');
}
