import type { UploadResponse } from '@/types';

/**
 * Combines per-chunk UploadResponse objects from a chunked import into a
 * single response the caller can use exactly like a non-chunked one.
 * - cards: concatenated in chunk order.
 * - totalRows / scryfallHits / scryfallMisses: summed.
 * - unresolvedNames: deduplicated, preserving first-seen order.
 * - fetchErrors: concatenated in chunk order (rows, not names — each chunk's
 *   withheld rows are disjoint, so no dedup is needed).
 * - malformedRows: concatenated in chunk order (each chunk's raw broken lines
 *   are disjoint, like fetchErrors).
 * - skippedUnownedRows / clampedRows: summed.
 * - detectedFormat: the format from the first chunk (all chunks come from
 *   the same source file so they detect identically).
 */
export function mergeUploadResponses(responses: UploadResponse[]): UploadResponse {
  if (responses.length === 0) throw new Error('mergeUploadResponses: no responses to merge');
  if (responses.length === 1) return responses[0];

  const merged: UploadResponse = {
    cards: [],
    totalRows: 0,
    scryfallHits: 0,
    scryfallMisses: 0,
    unresolvedNames: [],
    fetchErrors: [],
    malformedRows: [],
    skippedUnownedRows: 0,
    clampedRows: 0,
    detectedFormat: responses[0].detectedFormat,
  };
  const seenUnresolved = new Set<string>();
  for (const r of responses) {
    merged.cards.push(...r.cards);
    merged.totalRows += r.totalRows;
    merged.scryfallHits += r.scryfallHits;
    merged.scryfallMisses += r.scryfallMisses;
    merged.fetchErrors.push(...r.fetchErrors);
    merged.malformedRows.push(...r.malformedRows);
    merged.skippedUnownedRows += r.skippedUnownedRows;
    merged.clampedRows += r.clampedRows;
    for (const name of r.unresolvedNames) {
      if (seenUnresolved.has(name)) continue;
      seenUnresolved.add(name);
      merged.unresolvedNames.push(name);
    }
  }
  return merged;
}
