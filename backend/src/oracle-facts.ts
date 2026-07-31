import { logger } from './logger';
import type { ScryfallCache } from './cache';
import type { ScryfallCard } from './types';
import type { ImportRow } from './parsers/types';
import { resolveCards } from './scryfall';

/**
 * Bulk oracle lookup for collection-scale callers — today, cube generation,
 * which ranks EVERY unique name a player owns (10k+ for a real collection).
 *
 * That workload used to run in the browser against Scryfall's API: ~150
 * sequential /cards/collection round-trips plus an unbounded per-card tail,
 * which earned a 429 telling us to use bulk data (fixed defensively in #1427).
 * Serving it from here instead is both faster (one gzipped response off local
 * SQLite rather than ~40s of paced round-trips) and shared — the cache is
 * global, so the second player to build a cube pays nothing.
 *
 * Deliberately NOT the full card: this returns only what pool ranking reads —
 * identity, cost, type, colors, EDHREC rank, and the rules text the synergy
 * classifier parses. No images, no prices, no legalities. Card PREVIEWS still
 * resolve through the normal Scryfall path, on the few hundred picked cards,
 * where the payload cost is irrelevant and printing fidelity matters.
 */
export interface OracleFacts {
  /** Echoed back as sent, so the client can key its map without re-normalizing. */
  name: string;
  oracle_id?: string;
  cmc?: number;
  type_line?: string;
  /** Both faces joined for DFCs — the classifier reads them as one blob anyway. */
  oracle_text?: string;
  colors?: string[];
  keywords?: string[];
  edhrec_rank?: number;
}

/** One requested card. `scryfallId` (an owned printing) makes it a primary-key hit. */
export interface OracleRequest {
  name: string;
  scryfallId?: string;
}

/** Max cards per request. The client chunks; this bounds a single response. */
export const ORACLE_REQUEST_LIMIT = 2000;

/** Scryfall's name-only alias key, as written by `resolveCards`. */
function nameKey(name: string): string {
  return `n:${name.split(' // ')[0].trim().toLowerCase()}`;
}

/**
 * Project a cached card down to oracle facts. Multi-face layouts carry their
 * rules text (and sometimes type/cmc) on the faces rather than the top level,
 * so fall back to the faces the same way the frontend's `parseCard` does.
 */
export function toOracleFacts(name: string, card: ScryfallCard): OracleFacts {
  const faces = card.card_faces ?? [];
  const oracleText =
    card.oracle_text ??
    (faces.length > 0
      ? faces
          .map((f) => f.oracle_text ?? '')
          .filter(Boolean)
          .join('\n') || undefined
      : undefined);

  return {
    name,
    oracle_id: card.oracle_id,
    cmc: card.cmc ?? faces[0]?.cmc,
    type_line: card.type_line ?? faces[0]?.type_line,
    oracle_text: oracleText,
    colors: card.colors ?? faces[0]?.colors,
    keywords: card.keywords,
    edhrec_rank: card.edhrec_rank,
  };
}

/**
 * Resolve oracle facts for every requested card.
 *
 * Reads are **stale-OK**: rules text doesn't change, so honoring the cache's
 * 7-day price TTL here would expire a warm collection into a full re-fetch and
 * move the rate-limit problem to the server instead of solving it. Anything
 * genuinely absent falls through to `resolveCards`, which hits Scryfall with a
 * proper User-Agent, server-side pacing and 429 backoff — once, globally,
 * rather than once per player per session.
 */
export async function resolveOracleFacts(
  requests: OracleRequest[],
  cache: ScryfallCache
): Promise<OracleFacts[]> {
  const byName = new Map<string, OracleRequest>();
  for (const r of requests) {
    if (r.name && !byName.has(r.name)) byName.set(r.name, r);
  }
  if (byName.size === 0) return [];

  const facts = new Map<string, OracleFacts>();
  const pending = new Map<string, OracleRequest>(byName);

  // 1. Printing ids — the cards table's primary key, populated by every import,
  //    so an imported collection resolves here almost entirely.
  const ids = [...pending.values()].map((r) => r.scryfallId).filter((id): id is string => !!id);
  if (ids.length > 0) {
    const byId = cache.getMany(ids, true);
    for (const [name, req] of pending) {
      const card = req.scryfallId ? byId.get(req.scryfallId) : undefined;
      if (!card) continue;
      facts.set(name, toOracleFacts(name, card));
      pending.delete(name);
    }
  }

  // 2. Name aliases, for rows with no id (manual adds, older collections).
  if (pending.size > 0) {
    const keys = [...pending.keys()].map(nameKey);
    const byKey = cache.getManyByKeys(keys, true);
    for (const name of [...pending.keys()]) {
      const card = byKey.get(nameKey(name));
      if (!card) continue;
      facts.set(name, toOracleFacts(name, card));
      pending.delete(name);
    }
  }

  // 3. Whatever is left is genuinely uncached — resolve upstream and let
  //    `resolveCards` write it into the shared cache for everyone after us.
  if (pending.size > 0) {
    logger.info(`[oracle-facts] ${pending.size}/${byName.size} uncached, resolving upstream`);
    const rows: ImportRow[] = [...pending.values()].map((r) => ({
      name: r.name,
      scryfallId: r.scryfallId,
      quantity: 1,
      // Not a real import — `resolveCards` only reads name/set/collector/id.
      sourceFormat: 'plain',
    }));
    try {
      const { resolved } = await resolveCards(rows, cache);
      rows.forEach((row, i) => {
        const card = resolved[i];
        if (card) facts.set(row.name, toOracleFacts(row.name, card));
      });
    } catch (err) {
      // A partial answer still generates a usable cube — the client falls back
      // to its own collection rows for anything missing.
      logger.warn('[oracle-facts] upstream resolve failed:', err);
    }
  }

  return [...facts.values()];
}
