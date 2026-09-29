/**
 * Card facts accessor: lazy, typed lookups into public/card-facts.json.
 * Schema and pipeline are documented in schema.ts.
 *
 * Off the boot path by construction: nothing here runs until a deck-builder
 * caller awaits `loadCardFacts()`, and this module must only ever be imported
 * from deck-builder code (never from the app entry). Records decode on first
 * access and are memoized.
 *
 * Lookup order follows the keying rule: the oracle id first (a card object's
 * `oracle_id`), then the normalized FRONT-FACE name. A back face never keys a
 * record, so "Brainstorm" can't land on "Harmonized Trio // Brainstorm".
 *
 * Generation-inert in this slice: no generator phase calls into it yet.
 */
import { logger } from '@/lib/logger';
import { decodeCard, type EncodedCard, type Snapshot, type SnapshotMeta } from './codec';
import {
  CARD_FACTS_VERSION,
  TIER_WEIGHT,
  countsAsRole,
  factsNameKey,
  type CardFacts,
  type FactRole,
  type WeightedRoleFact,
} from './schema';

export * from './schema';
export { similarityTags, jaccard, mostSimilar } from './similarity';

const FACTS_URL = (import.meta.env.VITE_CARD_FACTS_URL as string | undefined) ?? '/card-facts.json';

interface Loaded {
  snapshot: Snapshot;
  byOracleId: Map<string, number>;
  byName: Map<string, number>;
  decoded: Map<number, CardFacts>;
}

let loaded: Loaded | null = null;
let loading: Promise<boolean> | null = null;

/** Build the lookup indexes for a snapshot. Exported for tests and the build script. */
export function indexSnapshot(snapshot: Snapshot): Loaded {
  const byOracleId = new Map<string, number>();
  const byName = new Map<string, number>();
  snapshot.cards.forEach(([oracleId, name], i) => {
    byOracleId.set(oracleId, i);
    const key = factsNameKey(name);
    const prev = byName.get(key);
    // Two records on one front-face key (none in the 2026-09 universe, but
    // Scryfall can print one): a single-faced card whose whole name is the
    // key beats a multi-faced one that merely starts with it; otherwise the
    // first record (by oracle id) stays.
    if (prev === undefined || (snapshot.cards[prev][1].includes(' // ') && !name.includes(' // ')))
      byName.set(key, i);
  });
  return { snapshot, byOracleId, byName, decoded: new Map() };
}

/** Install an already-parsed snapshot (tests, the build script). */
export function setCardFactsSnapshot(snapshot: Snapshot | null): void {
  loaded = snapshot ? indexSnapshot(snapshot) : null;
}

/**
 * Fetch the snapshot once. Resolves true when facts are available; false when
 * the file is missing, unreadable or from an incompatible schema version, in
 * which case every getter returns undefined and callers keep their current
 * behavior.
 */
export async function loadCardFacts(): Promise<boolean> {
  if (loaded) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(FACTS_URL);
      if (!res.ok) throw new Error("Couldn't load the card facts snapshot.");
      const snapshot = (await res.json()) as Snapshot;
      if (snapshot.version !== CARD_FACTS_VERSION) {
        logger.warn(
          `[CardFacts] Snapshot schema v${snapshot.version} does not match v${CARD_FACTS_VERSION}; ignoring it`
        );
        return false;
      }
      loaded = indexSnapshot(snapshot);
      logger.debug(
        `[CardFacts] Loaded ${snapshot.cards.length} cards (generated ${snapshot.meta.generatedAt})`
      );
      return true;
    } catch (err) {
      logger.warn('[CardFacts] Failed to load the card facts snapshot:', err);
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function hasCardFacts(): boolean {
  return loaded !== null;
}

/** Provenance of the loaded snapshot (bulk feed date, extractor, LLM model), or null. */
export function cardFactsMeta(): SnapshotMeta | null {
  return loaded?.snapshot.meta ?? null;
}

function decodeAt(i: number | undefined): CardFacts | undefined {
  if (i === undefined || !loaded) return undefined;
  let hit = loaded.decoded.get(i);
  if (!hit) {
    hit = decodeCard(loaded.snapshot, loaded.snapshot.cards[i] as EncodedCard);
    loaded.decoded.set(i, hit);
  }
  return hit;
}

export function getCardFactsByOracleId(oracleId: string): CardFacts | undefined {
  return decodeAt(loaded?.byOracleId.get(oracleId));
}

/**
 * Facts for a card: by `oracle_id` when the argument carries one, else by the
 * front face of its name. Undefined when the snapshot isn't loaded or doesn't
 * hold the card (a card printed after the snapshot, or not commander-legal).
 */
export function getCardFacts(
  card: string | { name: string; oracle_id?: string }
): CardFacts | undefined {
  if (!loaded) return undefined;
  if (typeof card !== 'string' && card.oracle_id) {
    const byId = getCardFactsByOracleId(card.oracle_id);
    if (byId) return byId;
  }
  return decodeAt(loaded.byName.get(factsNameKey(typeof card === 'string' ? card : card.name)));
}

/** Every role fact of a card with its weight; `counted` keeps only slot-filling ones. */
export function getRoleFacts(
  card: string | { name: string; oracle_id?: string },
  opts: { counted?: boolean } = {}
): WeightedRoleFact[] {
  const facts = getCardFacts(card);
  if (!facts) return [];
  return facts.roles
    .filter((r) => !opts.counted || countsAsRole(r))
    .map((r) => ({ ...r, weight: TIER_WEIGHT[r.tier] }));
}

/** Does the card fill this role slot (primary or secondary)? */
export function hasRole(
  card: string | { name: string; oracle_id?: string },
  role: FactRole
): boolean {
  return getRoleFacts(card, { counted: true }).some((r) => r.role === role);
}

/** A named function's strength (schema.ts `strengths`), 0 when absent. */
export function strengthOf(
  card: string | { name: string; oracle_id?: string },
  fn: string
): number {
  return getCardFacts(card)?.strengths[fn] ?? 0;
}

/** Every decoded record, for offline tooling (similarity eval). Decodes the whole snapshot. */
export function allCardFacts(): CardFacts[] {
  if (!loaded) return [];
  return loaded.snapshot.cards.map((_, i) => decodeAt(i)!);
}
