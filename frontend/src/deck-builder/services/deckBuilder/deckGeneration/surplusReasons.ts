import type { RoleKey } from '@/deck-builder/services/tagger/client';

// Reused verbatim by roleDeficitNotes.ts (E160) through phaseRoleSurplusRebalance.
export const ROLE_LABEL: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipe',
  cardDraw: 'card draw',
};

// A price increase over this (in the swap's own currency) is disclosed in
// the reason text — "nothing moves silently" ethos already used by the
// budget-repair notes elsewhere in the build report. Not a gate (see
// PRICE_SANITY_RATIO for the hard reject) — just the transparency floor.
const DISCLOSE_PRICE_DELTA = 1;

export function buildConversionReason(params: {
  role: RoleKey;
  have: number;
  target: number;
  nonbo: boolean;
  cutName: string;
  addedName: string;
  liftedBy?: string[];
  /** False for a same-role quality upgrade — a net-zero swap that does NOT
   *  reduce this role's over-cap count, so the wording must never claim it
   *  fixes the overage (defect 6b: dishonest disclosure). */
  isRoleExit: boolean;
  cutPrice: number;
  addedPrice: number;
  currency: 'USD' | 'EUR';
}): string {
  const label = ROLE_LABEL[params.role];
  const roleLabel = label.charAt(0).toUpperCase() + label.slice(1);
  const nonboClause = params.nonbo ? ` ${params.cutName} was also flagged as a nonbo.` : '';
  const sym = params.currency === 'EUR' ? '€' : '$';
  const priceClause =
    params.addedPrice - params.cutPrice > DISCLOSE_PRICE_DELTA
      ? ` (+${sym}${(params.addedPrice - params.cutPrice).toFixed(2)})`
      : '';
  const addedClause =
    params.liftedBy && params.liftedBy.length > 0
      ? `${params.isRoleExit ? 'Converted' : 'Upgraded'} to ${params.addedName}${priceClause}, lifted by ${params.liftedBy.slice(0, 3).join(', ')}.`
      : `${params.isRoleExit ? 'Converted' : 'Upgraded'} to ${params.addedName}${priceClause} for a stronger payoff.`;

  if (params.isRoleExit) {
    const capClause = `${roleLabel} is over cap (${params.have}/${params.target}).`;
    return `${capClause}${nonboClause} ${addedClause}`;
  }
  // Same-role swap: context for WHY this role's slots are under scrutiny at
  // all, without claiming this specific swap resolves the overage (it can't:
  // evicting and re-adding the same role nets to zero count change).
  const contextClause = `${roleLabel} is over cap (${params.have}/${params.target}). This swap upgrades a slot in the role. The count stays.`;
  return `${contextClause}${nonboClause} ${addedClause}`;
}

// E113 follow-up (half b); E160 generalizes from boardwipe-only to any
// DEFICIT_BACKFILL_ROLES member: the deficit-direction counterpart to
// buildConversionReason's "over cap" wording — Phase 3 backfills a role
// deficit, not a surplus, so the disclosure must say so honestly rather than
// reusing the "over cap" phrasing.
export function buildBackfillReason(params: {
  role: RoleKey;
  haveBefore: number;
  target: number;
  cutName: string;
  addedName: string;
  liftedBy?: string[];
  cutPrice: number;
  addedPrice: number;
  currency: 'USD' | 'EUR';
}): string {
  const sym = params.currency === 'EUR' ? '€' : '$';
  const priceClause =
    params.addedPrice - params.cutPrice > DISCLOSE_PRICE_DELTA
      ? ` (+${sym}${(params.addedPrice - params.cutPrice).toFixed(2)})`
      : '';
  const addedClause =
    params.liftedBy && params.liftedBy.length > 0
      ? `Added ${params.addedName}${priceClause}, lifted by ${params.liftedBy.slice(0, 3).join(', ')}.`
      : `Added ${params.addedName}${priceClause} to close the gap.`;
  const roleLabel = ROLE_LABEL[params.role];
  const capitalizedLabel = roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1);
  // "vs its N-card target" (E160 copy fix) reads correctly for every target
  // magnitude — the prior "vs a N target" produced "a 8 target" for removal's
  // larger targets; applies to wipes too (deliberate copy improvement).
  const deficitClause = `${capitalizedLabel} is under target (${params.haveBefore}/${params.target}). Freed a slot from ${params.cutName}. ${addedClause}`;
  return deficitClause;
}
