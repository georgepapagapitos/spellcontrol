import type { UploadResponse } from '../types';

/**
 * The single post-import review surface (E130) replaces four stacked
 * banners (success / routing / fetch-errors / malformed) with one
 * container. This module holds the surface's pure logic — merging a
 * multi-file batch's per-file buckets into one set of totals, and applying
 * an inline unresolved-name repair — so it ships with tests instead of
 * living inline in UploadPanel's commit handlers.
 */
export interface ImportOutcomeTotals {
  cardsImported: number;
  scryfallHits: number;
  unresolvedCount: number;
  fetchErrorCount: number;
  malformedCount: number;
  skippedUnownedCount: number;
  clampedCount: number;
}

/**
 * Sums the per-file buckets of a batch import into one totals object. A
 * batch (multiple staged files) runs one `importFile` per file, each
 * returning its own `UploadResponse` — this is the merge step so the
 * review surface shows one number per bucket instead of one per file.
 */
export function mergeImportResults(results: readonly UploadResponse[]): ImportOutcomeTotals {
  const totals: ImportOutcomeTotals = {
    cardsImported: 0,
    scryfallHits: 0,
    unresolvedCount: 0,
    fetchErrorCount: 0,
    malformedCount: 0,
    skippedUnownedCount: 0,
    clampedCount: 0,
  };
  for (const r of results) {
    totals.cardsImported += r.cards.length;
    totals.scryfallHits += r.scryfallHits;
    totals.unresolvedCount += r.unresolvedNames.length;
    totals.fetchErrorCount += r.fetchErrors.length;
    totals.malformedCount += r.malformedRows.length;
    totals.skippedUnownedCount += r.skippedUnownedRows;
    totals.clampedCount += r.clampedRows;
  }
  return totals;
}

/**
 * Applies an inline unresolved-name repair: the name the user just matched
 * to a Scryfall card (and added to the collection) is removed from the
 * withheld-names bucket. Exact-match filter — `unresolvedNames` is
 * deduped upstream (server `dedupePreservingOrder`), so a name never
 * appears twice.
 */
export function removeUnresolvedName(names: readonly string[], name: string): string[] {
  return names.filter((n) => n !== name);
}

/**
 * Headline for the review surface: anything still needing user action
 * (fetch errors to retry, unresolved names to fix) reads as attention-
 * needed rather than a flat "done" — malformed/skipped/clamped rows are
 * informational only (nothing left to do) and don't escalate it.
 */
export function importReviewHeadline(counts: {
  fetchErrorCount: number;
  unresolvedCount: number;
}): string {
  return counts.fetchErrorCount > 0 || counts.unresolvedCount > 0
    ? 'Import needs a look'
    : 'Import summary';
}
