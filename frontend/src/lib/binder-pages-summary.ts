import type { PocketSize } from '../types';

/** Page-filling mode labels, shared with `BinderEditor`'s Pages disclosure. */
export const PACK_LABEL: Record<string, string> = {
  false: 'New page per section',
  true: 'Fit whole sections',
  continuous: 'No gaps',
};

/**
 * The Pages disclosure's one-line summary (`BinderEditor`'s "Pages" row, and
 * the import review sheet that reuses it). Leads with capacity, in plain
 * words — capacity is what a binder is sold by, so it is the fact worth
 * reading first, and "No size limit" reads as a feature, not a warning
 * ("no limit" alone read like an error state). Layout facts (pocket count,
 * sides, page-fill mode) follow.
 *
 * Pure and reusable so a later pass at the Pages section itself (board T163)
 * doesn't have to re-derive this string.
 */
export function formatPagesSummary({
  pocketSize,
  doubleSided,
  fixedCapacity,
  packSections,
  sectionsFromRules,
}: {
  pocketSize: PocketSize;
  doubleSided: boolean;
  fixedCapacity: number | null;
  packSections: boolean | 'continuous';
  /** Sections come from rule groups (2+), not the sort chain — page-fill
   *  mode answers a different question there, so it drops out of the
   *  summary rather than naming a setting that isn't in play. */
  sectionsFromRules: boolean;
}): string {
  const capacity =
    fixedCapacity === null
      ? 'No size limit'
      : capacityPhrase(fixedCapacity, pocketSize, doubleSided);

  return [
    capacity,
    `${pocketSize}-pocket`,
    doubleSided ? 'both sides' : 'one side',
    sectionsFromRules ? null : PACK_LABEL[String(packSections)],
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Holds 360 cards (20 sheets)" — sheets are physical pages: a double-sided
 *  binder's front/back page pair is one sheet. */
function capacityPhrase(
  fixedCapacity: number,
  pocketSize: PocketSize,
  doubleSided: boolean
): string {
  const pages = Math.ceil(fixedCapacity / pocketSize);
  const sheets = doubleSided ? Math.ceil(pages / 2) : pages;
  return `Holds ${fixedCapacity.toLocaleString()} cards (${sheets.toLocaleString()} ${
    sheets === 1 ? 'sheet' : 'sheets'
  })`;
}
