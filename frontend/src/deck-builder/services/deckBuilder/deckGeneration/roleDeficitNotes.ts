import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import { getCardRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { computeRoleCounts } from '../commanderDeckAnalysis';
import { frontFaceName } from '@/lib/card-text';
import { REACTIVE_ROLES, ROLE_LABEL } from './phaseRoleSurplusRebalance';

// How many unseated pool candidates to name per deficient role — enough to
// show the disclosure isn't cherry-picked, terse enough to stay a one-line
// note (mirrors buildRoleCapOverflowNote's "one terse note" idiom in
// deckGenerator.ts, not a per-card list).
const MAX_DEFICIT_EXAMPLES = 2;

function capitalize(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Post-hoc, per-role "why is this role short" disclosure (E160) — the
 * pick-time-displacement counterpart to Phase 3's backfill
 * (phaseRoleSurplusRebalance.ts's DEFICIT_BACKFILL_ROLES). A residual
 * under-target role that backfill didn't (or couldn't) close — ramp/cardDraw
 * are out of DEFICIT_BACKFILL_ROLES this slice, or the backfill ran out of
 * donors/pool/budget — shipped short for a REASON that was invisible
 * everywhere in the build report until now (E139 gate: lathril lost
 * Assassin's Trophy to pick-time competition, removal 7/8 -> 6/8, its
 * synergyScore ROSE 53->63 — outcompeted, not devalued, undisclosed; iter-7
 * saw Krenko lose Lightning Greaves the same way).
 *
 * Computed over the FINAL deck, never a pick-time comparator-side collector
 * (iter-5 lesson, same defect class buildComboUpsideNotes /
 * countFinalPriceSanityPicks / countFinalWipeAsymmetry each independently
 * hit and fixed the same way): Array.sort() only makes O(n log n)
 * comparisons, so anything populated from inside a sort/priority comparator
 * systematically misses candidates that were never directly compared. This
 * scans the shipped deck plus the same batch-fetched EDHREC pool picking
 * actually drew from — deterministic, independent of comparator internals.
 *
 * `finalCount` uses commanderDeckAnalysis.ts's computeRoleCounts (front-face
 * role classification), matching deckGenerator.ts's own `finalRoleCounts`
 * (the report's roleCounts/roleGaps) — NOT phaseRoleSurplusRebalance.ts's own
 * live, all-faces-via-getCardRole tally, which can disagree by ±1 on a DFC
 * whose two faces classify differently. That divergence is an accepted
 * standing looseness elsewhere in the report already; this note stays
 * consistent with the fields that already accept it rather than trying to
 * reconcile it here.
 *
 * Undefined when every reactive role met its target (the common case) or
 * roleTargets/pool never got computed at all.
 */
export function buildRoleDeficitNotes(
  finalNonLandCards: ScryfallCard[],
  roleTargets: Record<RoleKey, number> | null,
  pool: readonly EDHRECCard[] | null | undefined,
  opts: {
    bannedCards?: ReadonlySet<string>;
    isSaltBlocked?: (name: string) => boolean;
  } = {}
): string[] | undefined {
  if (!roleTargets || !pool || pool.length === 0) return undefined;

  const finalCounts = computeRoleCounts(finalNonLandCards).roleCounts;

  // Front-face-aware "already shipped" set — mirrors phaseRoleSurplusRebalance
  // .ts's usedNames convention: an EDHREC pool entry for a DFC is keyed by its
  // front face, while a shipped card's own name can carry the full "A // B"
  // form, so index both forms to catch either direction.
  const shippedNames = new Set<string>();
  for (const card of finalNonLandCards) {
    shippedNames.add(card.name);
    if (card.name.includes(' // ')) shippedNames.add(frontFaceName(card.name));
  }

  const notes: string[] = [];
  for (const role of REACTIVE_ROLES) {
    const target = roleTargets[role] ?? 0;
    if (target <= 0) continue;
    const have = finalCounts[role] ?? 0;
    if (have >= target) continue; // met, or backfill already closed it

    const roleLabel = ROLE_LABEL[role];
    const headline = `${capitalize(roleLabel)} shipped ${have} of its ${target}-card target`;

    const candidates = pool
      .filter(
        (c) =>
          getCardRole(c.name) === role &&
          !shippedNames.has(c.name) &&
          !shippedNames.has(frontFaceName(c.name)) &&
          !opts.bannedCards?.has(c.name) &&
          !opts.isSaltBlocked?.(c.name)
      )
      .sort((a, b) => b.inclusion - a.inclusion)
      .slice(0, MAX_DEFICIT_EXAMPLES);

    if (candidates.length === 0) {
      notes.push(`${headline} — the EDHREC pool had no further ${roleLabel} to offer.`);
      continue;
    }
    const examples = candidates
      .map((c, i) =>
        i === 0
          ? `${c.name} (${Math.round(c.inclusion)}% of decks)`
          : `${c.name} (${Math.round(c.inclusion)}%)`
      )
      .join(' and ');
    notes.push(
      `${headline} — pool options like ${examples} were outcompeted at pick time by higher-ranked synergy and package picks.`
    );
  }

  return notes.length > 0 ? notes : undefined;
}
