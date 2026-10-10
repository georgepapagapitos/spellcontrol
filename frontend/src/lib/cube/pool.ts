import { apiUrl } from '@/lib/api/api-base';
import type { CubeCard } from './generate';
import { byQuality } from './generate';
import { cubeRole } from '@/deck-builder/services/tagger/client';
import { synergyTags } from './synergy-tags';
import { cubeSignalOf } from './signal';
import type { OracleFacts } from './oracle';
import type { EnrichedCard } from '@/types';
import type { RarityCap } from './pool-filters';
import { alwaysProducedMana, fixedColourOf } from '@/lib/mana-sim/unconditional-mana';

// ---------------------------------------------------------------------------
// API contract types
// ---------------------------------------------------------------------------

export interface FriendCard {
  name: string;
  oracleId: string;
  colors: string[];
  /** Color IDENTITY — optional because payloads cached before it shipped lack
   *  it. `friend-search.ts` treats absent-vs-empty as the difference between
   *  "unknown" and "colorless"; do NOT default it to [] at the boundary. */
  colorIdentity?: string[];
  cmc: number;
  typeLine: string;
  rarity?: string;
  edhrecRank?: number;
  /** Card-level facts the friend endpoint added later: rules text and
   *  legality in the filterable formats. Optional because cached payloads
   *  from before they shipped lack them — `friend-search.ts` strips `o:` /
   *  `f:` and the browser hides those facets when the payload has none. */
  oracleText?: string;
  legalities?: Record<string, string>;
  /** They have a copy to spare (one past the kept copy, in no deck or cube).
   *  A yes/no by contract, never a count. Optional for cached payloads. */
  spare?: boolean;
  /** Their decks this card is in, limited to ones the viewer can open;
   *  resolved against the `/decks` shelf for names and links. */
  deckIds?: string[];
  // Populated during Scryfall enrichment (see CubePage), not by the API.
  synergyProducers?: CubeCard['synergyProducers'];
  synergyPayoffs?: CubeCard['synergyPayoffs'];
}

export interface FriendCollectionResponse {
  ownerUsername: string;
  /** They set their collection to Private (board T136): `cards` is empty on
   *  purpose. Optional for an older backend. */
  collectionPrivate?: true;
  /** Their profile's Collection tab opens for you, with the quantities and
   *  prices this card-level view leaves out. */
  fullView?: boolean;
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

const FRIEND_RARITY_OK: Record<RarityCap, (rarity?: string) => boolean> = {
  any: () => true,
  peasant: (r) => r === 'common' || r === 'uncommon',
  pauper: (r) => r === 'common',
};

/**
 * Friends' cards always count regardless of the "Cards" (availability) source
 * picker in the build page's "Draw from" — their availability isn't ours to
 * filter. The rarity cap DOES apply: a friend's payload carries the printing's
 * rarity. The price ceiling does NOT: `FriendCard` carries no price at all, so
 * filtering by it would drop every friend card rather than none. `eligible`
 * carries the one other rule shared with owned cards — the play-format
 * exclusion (commander-only / group-hug politics cards).
 */
export function filterFriendCards(
  cards: FriendCard[],
  rarity: RarityCap,
  eligible: (name: string) => boolean
): FriendCard[] {
  return cards.filter((c) => FRIEND_RARITY_OK[rarity](c.rarity) && eligible(c.name));
}

export async function fetchFriendCollection(friendId: string): Promise<FriendCollectionResponse> {
  const res = await fetch(apiUrl(`/api/friends/${encodeURIComponent(friendId)}/collection`), {
    credentials: 'include',
  });
  if (!res.ok) {
    const msg = await readError(res, "Couldn't load your friend's collection. Try again.");
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
  friendCollections: Array<{ username: string; cards: FriendCard[] }>,
  /** Same pauper/peasant scope the build is using — see signal.ts. */
  scope: RarityCap = 'any'
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
        colorIdentity: fc.colorIdentity,
        oracleText: fc.oracleText,
        ...cubeSignalOf(fc.name, scope),
        synergyProducers: fc.synergyProducers,
        synergyPayoffs: fc.synergyPayoffs,
      };

      const existing = byOracle.get(key);
      if (existing) {
        // Add the friend as a supplier.
        if (!existing.suppliers.includes(username)) {
          existing.suppliers.push(username);
        }
        // Keep the better copy (lower rank; oracleId tiebreaks so the winner is
        // deterministic regardless of insertion order — mirrors byQuality in generate.ts).
        if (byQuality(friendCard, existing.card) < 0) {
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

/**
 * Map unique card names to a `CubeCard[]` pool, preferring Scryfall-enriched data
 * and falling back to the owned collection copy. Shared by the solo and collab
 * build flows (both build the same name→CubeCard pool from their own collection).
 *
 * Takes `OracleFacts`, not a full `ScryfallCard`, because ranking reads only
 * oracle data — that's what lets the pool pass come from our own backend
 * (`fetchCubeOracle`) rather than a collection-scale walk of the Scryfall API.
 * A full `ScryfallCard` still satisfies the type.
 */
export function namesToCubePool(
  names: string[],
  collectionCards: EnrichedCard[],
  enriched: Map<string, OracleFacts>,
  /** Same pauper/peasant scope the pool's filters used — see signal.ts. */
  scope: RarityCap = 'any'
): CubeCard[] {
  const ownedByName = new Map<string, EnrichedCard>();
  for (const c of collectionCards)
    if (c.name && !ownedByName.has(c.name)) ownedByName.set(c.name, c);
  return names.map((name) => {
    const card = ownedByName.get(name);
    const s = enriched.get(name);
    return {
      name,
      oracleId: s?.oracle_id ?? card?.oracleId ?? name.toLowerCase(),
      colors: s?.colors ?? card?.colors ?? [],
      cmc: s?.cmc ?? card?.cmc ?? 0,
      typeLine: s?.type_line ?? card?.typeLine ?? '',
      role: cubeRole(name),
      rank: s?.edhrec_rank ?? card?.edhrecRank,
      colorIdentity: s?.color_identity ?? card?.colorIdentity,
      producedMana: alwaysProducedMana(s?.oracle_text, s?.produced_mana),
      fixesWith: fixedColourOf(s?.oracle_text),
      oracleText: s?.oracle_text,
      ...cubeSignalOf(name, scope),
      ...synergyTags(s ?? { name }),
    };
  });
}

/**
 * Who brings each pick to the table. A cube needs ONE copy of each card, so a
 * card more than one of you owns goes on exactly one person's pull list, never
 * all of them:
 * - the builder (`myUsername`) brings anything they own, which matches the
 *   card list's own row chip and the physical pull list, where their copies
 *   are the ones reserved;
 * - a card only friends own goes to whichever of them has been handed the
 *   fewest so far (ties go to the earlier listed supplier), so the load
 *   spreads instead of piling onto the first friend added.
 *
 * Picks are walked in cube order, so the result is deterministic for a given
 * cube. Returns oracleId → username; a pick with no supplier entry is absent.
 */
export function assignSuppliers(
  picks: ReadonlyArray<{ card: { oracleId: string } }>,
  supplierMap: ReadonlyMap<string, string[]>,
  myUsername: string
): Map<string, string> {
  const assigned = new Map<string, string>();
  const load = new Map<string, number>();
  for (const { card } of picks) {
    if (!card.oracleId || assigned.has(card.oracleId)) continue;
    const suppliers = supplierMap.get(card.oracleId);
    if (!suppliers || suppliers.length === 0) continue;
    let who = suppliers.includes(myUsername) ? myUsername : suppliers[0];
    if (who !== myUsername) {
      for (const s of suppliers) {
        if ((load.get(s) ?? 0) < (load.get(who) ?? 0)) who = s;
      }
    }
    assigned.set(card.oracleId, who);
    load.set(who, (load.get(who) ?? 0) + 1);
  }
  return assigned;
}
