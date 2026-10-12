import type { CoherenceRepair, ScryfallCard } from '@/deck-builder/types';

/** Why the land base ran out of nonbasics: the clause the note ends on. */
export type NonbasicShortfallReason = 'repair' | 'price' | 'budget' | 'collection' | 'pool';

export const REASON_CLAUSE: Record<NonbasicShortfallReason, string> = {
  repair: 'the deck check swapped a land that does not fit for a basic.',
  price: 'no fitting land under the price limit.',
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

const isBasicName = (name: string) =>
  /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(name);

/** Land swaps the coherence repair made from a nonbasic to a basic. */
export function countRepairSwapsToBasic(repairs: readonly CoherenceRepair[] | undefined): number {
  return (repairs ?? []).filter((r) => isBasicName(r.added) && !isBasicName(r.cut)).length;
}

/**
 * The cause of a nonbasic shortfall, from what happened to this deck rather
 * than from which settings were on: a coherence repair that swapped nonbasics
 * for basics owns the slots it took; a price ceiling counts only when set; a
 * deck budget counts only when the deck's spend actually reached it.
 */
export function nonbasicShortfallReason(params: {
  short: number;
  repairSwaps: number;
  cz: { deckBudget?: number | null; maxCardPrice?: number | null };
  ownedOnly: boolean;
  /** What the deck costs against the budget (owned-exempt cards left out). */
  spend: number;
}): NonbasicShortfallReason {
  const { cz } = params;
  if (params.repairSwaps >= params.short && params.repairSwaps > 0) return 'repair';
  if (cz.maxCardPrice != null) return 'price';
  if (cz.deckBudget != null && params.spend >= cz.deckBudget * 0.9) return 'budget';
  if (params.ownedOnly) return 'collection';
  return 'pool';
}

/** How many nonbasic slots the final lands left short of the target. */
export function nonbasicShortfall(lands: readonly ScryfallCard[], targetNonBasic: number): number {
  const nonbasic = lands.filter((c) => !c.type_line.includes('Basic')).length;
  return Math.max(0, Math.min(targetNonBasic, lands.length) - nonbasic);
}

/** `landCountNote` with the shortfall clause appended when there is one. */
export function withNonbasicShortfall(
  landCountNote: string | undefined,
  lands: readonly ScryfallCard[],
  targetNonBasic: number,
  cz: { deckBudget?: number | null; maxCardPrice?: number | null },
  ownedOnly = false,
  what: { repairs?: readonly CoherenceRepair[]; spend?: number } = {}
): string | undefined {
  const reason = nonbasicShortfallReason({
    short: nonbasicShortfall(lands, targetNonBasic),
    repairSwaps: countRepairSwapsToBasic(what.repairs),
    cz,
    ownedOnly,
    // Without a spend figure a deck budget is taken as binding, as before.
    spend: what.spend ?? Number.POSITIVE_INFINITY,
  });
  const note = buildNonbasicShortfallNote({ lands, targetNonBasic, reason });
  return note ? (landCountNote ? `${landCountNote} ${note}` : note) : landCountNote;
}
