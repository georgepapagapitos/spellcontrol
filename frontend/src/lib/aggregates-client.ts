import { apiUrl } from './api-base';

/** `GET /api/aggregates/commanders/:commanderKey` response shape (w4-aggregates-backend). */
export interface CommanderStats {
  commanderKey: string;
  commanderName: string;
  partnerName: string | null;
  deckCount: number;
  avgBracket: number | null;
  bracketSampleCount: number;
  budgetDistribution: { low: number | null; mid: number | null; high: number | null };
  topCards: Array<{ oracleId: string; cardName: string; deckCount: number; pct: number }>;
}

/**
 * Read client for the commander-popularity aggregate (w4-aggregates-backend).
 * Modeled on share-client.ts's shape (apiUrl() + fetch + typed response), with
 * one deliberate divergence: share-client.ts's functions `throw` on failure;
 * every function here instead SWALLOWS errors and resolves null/empty,
 * because every call site in this program is a secondary, non-blocking text
 * line (a stat, a badge) — never primary content.
 */

/** `null` on 404 (below MIN_COMMANDER_DECKS) or any network error — never
 *  throws into the render path. */
export async function getCommanderStats(commanderKey: string): Promise<CommanderStats | null> {
  try {
    const res = await fetch(
      apiUrl(`/api/aggregates/commanders/${encodeURIComponent(commanderKey)}`)
    );
    if (!res.ok) return null;
    return (await res.json()) as CommanderStats;
  } catch {
    return null;
  }
}

/** Empty Map on total failure; a key with no row (unknown or below threshold)
 *  is simply absent from the map, mirroring the backend's own silent-omission
 *  contract for this endpoint. */
export async function getCommanderStatsBatch(keys: string[]): Promise<Map<string, CommanderStats>> {
  if (keys.length === 0) return new Map();
  try {
    const res = await fetch(
      apiUrl(`/api/aggregates/commanders?keys=${keys.map(encodeURIComponent).join(',')}`)
    );
    if (!res.ok) return new Map();
    const body = (await res.json()) as { commanders: CommanderStats[] };
    return new Map(body.commanders.map((c) => [c.commanderKey, c]));
  } catch {
    return new Map();
  }
}
