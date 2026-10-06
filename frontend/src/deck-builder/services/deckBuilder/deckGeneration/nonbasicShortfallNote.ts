import type { ScryfallCard } from '@/deck-builder/types';

/**
 * E552: the nonbasic land count is a target the land base can miss when a price
 * ceiling leaves no fitting land, and the slot then goes to a basic. Name it
 * once, from the final lands, so the shortfall is disclosed instead of silent.
 * Only under a price ceiling: without one a shortfall is pool exhaustion, which
 * has its own note.
 */
export function buildNonbasicShortfallNote(params: {
  lands: readonly ScryfallCard[];
  /** The nonbasic count the land base was built to (the effective budget). */
  targetNonBasic: number;
  hasPriceCeiling: boolean;
}): string | undefined {
  if (!params.hasPriceCeiling) return undefined;
  const nonbasic = params.lands.filter((c) => !c.type_line.includes('Basic')).length;
  const short = Math.min(params.targetNonBasic, params.lands.length) - nonbasic;
  if (short <= 0) return undefined;
  const slots =
    short === 1 ? '1 nonbasic slot went to a basic' : `${short} nonbasic slots went to basics`;
  return `${slots}: no fitting land under the budget.`;
}

/** `landCountNote` with the shortfall clause appended when there is one. */
export function withNonbasicShortfall(
  landCountNote: string | undefined,
  lands: readonly ScryfallCard[],
  targetNonBasic: number,
  cz: { deckBudget?: number | null; maxCardPrice?: number | null }
): string | undefined {
  const note = buildNonbasicShortfallNote({
    lands,
    targetNonBasic,
    hasPriceCeiling: cz.deckBudget != null || cz.maxCardPrice != null,
  });
  return note ? (landCountNote ? `${landCountNote} ${note}` : note) : landCountNote;
}
