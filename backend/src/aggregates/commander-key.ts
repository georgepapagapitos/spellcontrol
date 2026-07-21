/**
 * Order-independent identity for a commander (or commander+partner pair) in
 * the aggregate rollup (social program W4) — sorting before joining means
 * A+B and B+A land on the same `commander_stats` row, since partner order is
 * just an artifact of which slot a player dropped each card into, never
 * aggregation-meaningful.
 *
 * A falsy id (missing/empty commander or partner oracle id) is dropped from
 * the key rather than joined in — same "drop silently rather than crash"
 * philosophy as combos/ingest.ts's `parseVariant`. Skipping a deck entirely
 * when `commanderOracleId` itself is missing is the caller's job
 * (`computeCommanderAggregates` in rollup.ts); this function only shapes the
 * key from whatever id(s) it's given.
 */
export function buildCommanderKey(
  commanderOracleId: string,
  partnerOracleId?: string | null
): string {
  return [commanderOracleId, partnerOracleId].filter(Boolean).sort().join('+');
}
