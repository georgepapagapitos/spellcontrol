import { apiUrl } from '../api-base';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { offlineDataAvailable, useOfflineStore } from '@/store/offline';
import type { EnrichedCard } from '@/types';
import type { CardFetchProgress } from '@/deck-builder/services/scryfall/card-repository';

/**
 * The subset of a Scryfall card that cube POOL RANKING reads: identity, cost,
 * type, colors, EDHREC rank, and the rules text `synergyTags` classifies.
 * A full `ScryfallCard` satisfies this, so callers can mix both sources.
 */
export interface OracleFacts {
  name: string;
  oracle_id?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  keywords?: string[];
  edhrec_rank?: number;
}

/** Matches ORACLE_REQUEST_LIMIT on the server. */
const CHUNK_SIZE = 2000;

function offlineActive(): boolean {
  try {
    return offlineDataAvailable(useOfflineStore.getState());
  } catch {
    return false;
  }
}

/**
 * Oracle data for every name in a cube pool — potentially the player's WHOLE
 * collection (10k+ names).
 *
 * That is a bulk-data workload, and running it against Scryfall from the
 * browser is what got us rate-limited: ~150 sequential round-trips plus a
 * per-card tail, repeated every session because the client-side card cache is
 * in-memory. So the default path asks OUR backend, which answers from its
 * shared SQLite Scryfall cache in one gzipped response per 2000 names.
 *
 * Card PREVIEWS are deliberately not served from here — they need images and
 * printing details, and they only ever cover the few hundred PICKED cards,
 * which the normal Scryfall path handles comfortably.
 *
 * Falls back to the live Scryfall path when the backend can't answer, and
 * skips the network entirely when the native offline bundle is present.
 */
export async function fetchCubeOracle(
  names: string[],
  collectionCards: EnrichedCard[],
  onProgress?: CardFetchProgress
): Promise<Map<string, OracleFacts>> {
  if (names.length === 0) return new Map();

  // Native with the offline bundle: the local oracle store already has all of
  // this, and reads no network at all.
  if (offlineActive()) return getCardsByNames(names, onProgress);

  // An owned printing id makes the server's lookup a primary-key cache hit.
  const idByName = new Map<string, string>();
  for (const c of collectionCards) {
    if (c.name && c.scryfallId && !idByName.has(c.name)) idByName.set(c.name, c.scryfallId);
  }

  const result = new Map<string, OracleFacts>();
  try {
    for (let i = 0; i < names.length; i += CHUNK_SIZE) {
      const chunk = names.slice(i, i + CHUNK_SIZE);
      const res = await fetch(apiUrl('/api/cards/oracle-facts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cards: chunk.map((name) => ({ name, scryfallId: idByName.get(name) })),
        }),
      });
      if (!res.ok) throw new Error(`oracle-facts ${res.status}`);
      const body = (await res.json()) as { cards?: OracleFacts[] };
      for (const card of body.cards ?? []) result.set(card.name, card);
      onProgress?.(Math.min(i + CHUNK_SIZE, names.length), names.length);
    }
    return result;
  } catch {
    // Backend unreachable or erroring — fall back to the live Scryfall path so
    // a cube can still be built. Bounded since #1427, just slower.
    return getCardsByNames(names, onProgress);
  }
}
