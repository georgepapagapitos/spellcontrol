/**
 * Order-independent identity for a commander (or commander+partner pair) —
 * frontend port of `backend/src/aggregates/commander-key.ts`. Deliberately
 * duplicated rather than shared via a `packages/*` module (constraint #1:
 * no new shared package for 5 lines of logic) — keep the two in sync by
 * hand; this is the algorithm both must match.
 *
 * A falsy id (missing/empty commander or partner oracle id) is dropped from
 * the key rather than joined in, same as the backend version.
 */
export function buildCommanderKey(
  commanderOracleId?: string,
  partnerOracleId?: string | null
): string {
  return [commanderOracleId, partnerOracleId].filter(Boolean).sort().join('+');
}
