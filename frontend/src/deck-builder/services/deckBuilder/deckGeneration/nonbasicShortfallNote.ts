import type { ScryfallCard } from '@/deck-builder/types';

/** Why the land base ran out of nonbasics: the clause the note ends on. */
export type NonbasicShortfallReason = 'budget' | 'collection' | 'pool';

const REASON_CLAUSE: Record<NonbasicShortfallReason, string> = {
  budget: 'no fitting land under the budget.',
  collection: 'no other fitting land in your collection.',
  pool: 'no other fitting land for this deck.',
};

/**
 * E552: the nonbasic land count is a target the land base can miss, and the
 * slot then goes to a basic. Name it once, from the final lands, so the
 * shortfall is disclosed instead of silent. It once fired only under a price
 * ceiling, so an owned-only build asked for 26 basics shipped 29 without a
 * word (Zo-Zu, 2026-10-12).
 */
export function buildNonbasicShortfallNote(params: {
  lands: readonly ScryfallCard[];
  /** The nonbasic count the land base was built to (the effective budget). */
  targetNonBasic: number;
  reason: NonbasicShortfallReason;
}): string | undefined {
  const nonbasic = params.lands.filter((c) => !c.type_line.includes('Basic')).length;
  const short = Math.min(params.targetNonBasic, params.lands.length) - nonbasic;
  if (short <= 0) return undefined;
  const slots =
    short === 1 ? '1 nonbasic slot went to a basic' : `${short} nonbasic slots went to basics`;
  return `${slots}: ${REASON_CLAUSE[params.reason]}`;
}

/** `landCountNote` with the shortfall clause appended when there is one. */
export function withNonbasicShortfall(
  landCountNote: string | undefined,
  lands: readonly ScryfallCard[],
  targetNonBasic: number,
  cz: { deckBudget?: number | null; maxCardPrice?: number | null },
  ownedOnly = false
): string | undefined {
  const note = buildNonbasicShortfallNote({
    lands,
    targetNonBasic,
    reason:
      cz.deckBudget != null || cz.maxCardPrice != null
        ? 'budget'
        : ownedOnly
          ? 'collection'
          : 'pool',
  });
  return note ? (landCountNote ? `${landCountNote} ${note}` : note) : landCountNote;
}
