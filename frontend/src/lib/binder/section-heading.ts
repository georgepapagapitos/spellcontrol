/**
 * Heading for a binder section, given the group label of each card visible in
 * it (`BinderSection.cardLabels`, or the same labels resolved per card on the
 * shared view).
 *
 * Page filling (`packSections`) merges several groups into one section, and its
 * `label` is their ` · ` join — 40 drop names on a real Secret Lair binder,
 * which is a wall of text in a header row. Name the first group and count the
 * rest instead; the full run stays available as the element's `title`.
 *
 * Derived from the cards actually on screen, so a search that hides a whole
 * group drops it from the count too.
 */
export function sectionHeading(cardLabels: string[] | undefined, fallback: string): string {
  if (!cardLabels?.length) return fallback;
  const distinct = [...new Set(cardLabels)];
  return distinct.length > 1 ? `${distinct[0]} +${distinct.length - 1} more` : distinct[0];
}
