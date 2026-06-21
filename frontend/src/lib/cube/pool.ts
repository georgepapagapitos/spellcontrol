import { apiUrl } from '../api-base';
import type { CubeCard } from './generate';

// ---------------------------------------------------------------------------
// API contract types
// ---------------------------------------------------------------------------

export interface FriendCard {
  name: string;
  oracleId: string;
  colors: string[];
  cmc: number;
  typeLine: string;
  edhrecRank?: number;
  // Populated during Scryfall enrichment (see CubePage), not by the API.
  synergyProducers?: CubeCard['synergyProducers'];
  synergyPayoffs?: CubeCard['synergyPayoffs'];
}

export interface FriendCollectionResponse {
  ownerUsername: string;
  /** Already oracle-deduped server-side. */
  cards: FriendCard[];
}

// ---------------------------------------------------------------------------
// Pool types
// ---------------------------------------------------------------------------

/**
 * A card entry in the merged pool, parallel to CubeCard.
 * suppliers is kept separately in supplierMap — generateCube owns CubeCard.
 */
export interface PoolCard extends CubeCard {
  suppliers: string[];
}

export interface ContributionSummary {
  username: string;
  role: 'me' | 'friend';
  /** How many picked cards this person can supply (a multi-supplier card counts for each). */
  supplies: number;
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

class FriendCollectionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'FriendCollectionError';
    this.status = status;
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function fetchFriendCollection(friendId: string): Promise<FriendCollectionResponse> {
  const res = await fetch(apiUrl(`/api/friends/${encodeURIComponent(friendId)}/collection`), {
    credentials: 'include',
  });
  if (!res.ok) {
    const msg = await readError(res, `Could not load friend's collection (${res.status}).`);
    throw new FriendCollectionError(msg, res.status);
  }
  return (await res.json()) as FriendCollectionResponse;
}

// ---------------------------------------------------------------------------
// Pool merging
// ---------------------------------------------------------------------------

/**
 * Pure merge: combine the current user's CubeCard pool with up to 3 friends'
 * FriendCard lists into a single deduplicated pool suitable for generateCube.
 *
 * Rules:
 * - Dedupe by oracleId.
 * - Own cards are inserted first (suppliers = [myUsername]).
 * - For a friend card that matches an existing oracleId: add the friend to
 *   suppliers and keep the lower-rank (better) copy.
 * - For a friend card with a new oracleId: insert it (role: null) with
 *   suppliers = [friendUsername].
 * - Cards with empty oracleId are skipped.
 *
 * Returns:
 * - pool: CubeCard[] (no suppliers embedded — generateCube owns CubeCard)
 * - supplierMap: Map<oracleId, string[]> parallel suppliers list
 */
export function mergePools(
  myCards: CubeCard[],
  myUsername: string,
  friendCollections: Array<{ username: string; cards: FriendCard[] }>
): { pool: CubeCard[]; supplierMap: Map<string, string[]> } {
  // Working map: oracleId → { card, suppliers }
  const byOracle = new Map<string, { card: CubeCard; suppliers: string[] }>();

  // Insert own cards first.
  for (const card of myCards) {
    const key = card.oracleId;
    if (!key) continue;
    if (!byOracle.has(key)) {
      byOracle.set(key, { card, suppliers: [myUsername] });
    }
    // Own cards are already deduped by the caller (BuildCube dedupes by name;
    // generateCube dedupes by oracleId). If a duplicate slips in, skip it.
  }

  // Merge each friend's collection.
  for (const { username, cards } of friendCollections) {
    for (const fc of cards) {
      const key = fc.oracleId;
      if (!key) continue;

      const friendCard: CubeCard = {
        name: fc.name,
        oracleId: fc.oracleId,
        colors: fc.colors,
        cmc: fc.cmc,
        typeLine: fc.typeLine,
        role: null,
        rank: fc.edhrecRank,
        synergyProducers: fc.synergyProducers,
        synergyPayoffs: fc.synergyPayoffs,
      };

      const existing = byOracle.get(key);
      if (existing) {
        // Add the friend as a supplier.
        if (!existing.suppliers.includes(username)) {
          existing.suppliers.push(username);
        }
        // Keep the lower-rank (better) copy.
        const existingRank = existing.card.rank ?? Infinity;
        const friendRank = friendCard.rank ?? Infinity;
        if (friendRank < existingRank) {
          byOracle.set(key, { card: friendCard, suppliers: existing.suppliers });
        }
      } else {
        byOracle.set(key, { card: friendCard, suppliers: [username] });
      }
    }
  }

  const pool: CubeCard[] = [];
  const supplierMap = new Map<string, string[]>();
  for (const [oracleId, { card, suppliers }] of byOracle) {
    pool.push(card);
    supplierMap.set(oracleId, suppliers);
  }

  return { pool, supplierMap };
}
