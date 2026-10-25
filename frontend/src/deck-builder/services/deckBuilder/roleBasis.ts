/**
 * Where a shown role target comes from: the references the analysis puts
 * beside it. DISPLAY ONLY. Nothing here feeds the generator or the Coach's
 * ranking; `getBaseRoleTargets` / `getDynamicRoleTargets` keep sizing the
 * targets, and `roleBasis.test.ts` pins their numbers so a change here cannot
 * move them (roadmap 3.3; the generator side is 5.4a/c, behind the ship gate).
 *
 * Three kinds of number, kept apart because they are not equally firm:
 * - exact: a count taken from the deck itself (not in this module);
 * - measured: counted over real decks (`ROLE_BASELINE`, `BRACKET_REFERENCE`);
 * - estimate: a reference that is applied to this deck, not a rule it must
 *   meet (`EXPERT_TEMPLATE`, and this commander's EDHREC count).
 */
import type { RoleKey } from '@/deck-builder/services/tagger/client';

/** EDHREC average decks the baseline was measured over (08 §4.1, broad sample). */
export const BASELINE_SAMPLE = 93;

export interface RoleSpread {
  median: number;
  /** First and third quartile: the middle half of the sample. */
  q1: number;
  q3: number;
}

/** Per-role counts across 93 EDHREC average decks (08 §4.1). Spot removal and sweepers for the two removal roles. */
export const ROLE_BASELINE: Readonly<Record<RoleKey, RoleSpread>> = {
  ramp: { median: 10, q1: 7, q3: 14 },
  removal: { median: 8, q1: 6, q3: 11 },
  boardwipe: { median: 2, q1: 1, q3: 3 },
  cardDraw: { median: 9, q1: 7, q3: 13 },
};

/**
 * The Command Zone's 2025 template (episode 658): card advantage 12, ramp 10,
 * targeted disruption 12, mass disruption 6. We have it from a third-party
 * summary of the episode, not the show, so it is always shown as an estimate
 * (06 §3). Disruption is broader than our removal tag (it adds counters,
 * bounce and tappers), so the removal figure reads high against our count.
 */
export const EXPERT_TEMPLATE: Readonly<Record<RoleKey, number>> = {
  ramp: 10,
  removal: 12,
  boardwipe: 6,
  cardDraw: 12,
};

export interface BracketReference {
  lands: string;
  tutors: string;
  averageMv: string;
}

/** Lands, tutors and average mana value by bracket (08 §7.3). Brackets 1 to 3 share a row. */
export function bracketReference(bracket: 1 | 2 | 3 | 4 | 5): BracketReference {
  if (bracket === 5) return { lands: '28 to 31', tutors: '8 to 10', averageMv: '2.1 to 2.2' };
  if (bracket === 4) return { lands: '33 to 34', tutors: '3 to 4', averageMv: '2.8' };
  return { lands: '35 to 36', tutors: '0 to 3', averageMv: '2.9 to 3.1' };
}

export interface RoleBasisRow {
  role: RoleKey;
  /** The target the bar is drawn against. */
  target: number | undefined;
  /** Cards in this role that at least 1 in 4 of this commander's EDHREC decks play; null when unknown. */
  commander: number | null;
  baseline: RoleSpread;
  expert: number;
}

export const ROLE_BASIS_ORDER: readonly RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];

/** One row per role, in panel order. `commanderCounts` is null for a deck with no EDHREC page. */
export function roleBasisRows(
  targets: Readonly<Record<RoleKey, number | undefined>>,
  commanderCounts: Readonly<Record<RoleKey, number>> | null | undefined
): RoleBasisRow[] {
  return ROLE_BASIS_ORDER.map((role) => ({
    role,
    target: targets[role],
    commander: commanderCounts ? (commanderCounts[role] ?? null) : null,
    baseline: ROLE_BASELINE[role],
    expert: EXPERT_TEMPLATE[role],
  }));
}
