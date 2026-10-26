import { HARDCODED_GAME_CHANGERS as SHARED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import { logger } from '@/lib/util/logger';
import { scryfallFetch } from '@/lib/cards/scryfall-fetch';
import { frontFaceName } from '@/lib/cards/card-text';
import type { ScryfallSearchResponse } from '@/deck-builder/types';
import { readGameChangerSnapshot, writeGameChangerSnapshot } from './gamechangers-snapshot';

/**
 * Official Commander Game Changers list — now shared.
 *
 * The list itself moved to `@spellcontrol/deck-metrics` because the backend
 * needs the same one for the AI `check_bracket` tool and has no other source
 * (its card cache stores a trimmed field set with no `game_changer` flag). Two
 * hand-maintained copies would drift, and this list drives a HARD bracket floor
 * — the two apps would end up disagreeing about a deck's bracket. This module
 * still owns the LIVE `is:gamechanger` query, which is authoritative on a
 * complete fetch (see `liveGetGameChangerNames`) and falls back to this list
 * only when the live fetch fails or breaks mid-page.
 */
const HARDCODED_GAME_CHANGERS = SHARED_GAME_CHANGERS;

// Cached set of game changer card names from Scryfall
let gameChangerNamesCache: Set<string> | null = null;
let gameChangerCacheTimestamp = 0;
const GC_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Live fetch of all `is:gamechanger` card names from Scryfall, paginated.
 *
 * A COMPLETE live fetch is authoritative on its own, not unioned with the
 * hardcoded list — the RC removes cards from the GC list too (ten in Oct
 * 2025), and unioning would keep flooring a removed card until someone edits
 * the hardcoded copy. The hardcoded list is only ever a fallback: whole (page
 * 1 fails, so there's nothing live to trust) or partial-floor (pagination
 * breaks after page 1, so the live set so far is unioned rather than risking
 * an undercount from a page that never arrived).
 */
export function liveGetGameChangerNames(): Promise<Set<string>> {
  if (gameChangerNamesCache && Date.now() - gameChangerCacheTimestamp < GC_CACHE_TTL) {
    return Promise.resolve(gameChangerNamesCache);
  }
  // One fetch for every caller that arrives while it runs: each used to run its own
  // paginated search, and every one is a slot on the shared limiter.
  gameChangerInFlight ??= fetchGameChangerNames().finally(() => {
    gameChangerInFlight = null;
  });
  return gameChangerInFlight;
}
let gameChangerInFlight: Promise<Set<string>> | null = null;

/** The whole paginated fetch gets this long; the list is ~53 cards, one page. */
const GC_FETCH_TIMEOUT_MS = 15_000;
const MAX_GC_PAGES = 5;

async function fetchGameChangerNames(): Promise<Set<string>> {
  const names = new Set<string>();
  let page = 1;
  let hasMore = true;
  let completedFully = true;
  // A hung request must not wedge every caller sharing the in-flight latch: past the
  // deadline (or the page cap) the fetch counts as incomplete, like a broken page.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('gamechanger fetch timed out')), GC_FETCH_TIMEOUT_MS);
  });
  deadline.catch(() => undefined);

  while (hasMore) {
    try {
      if (page > MAX_GC_PAGES) throw new Error('gamechanger fetch overran its page cap');
      const response = await Promise.race([
        scryfallFetch<ScryfallSearchResponse>(
          `/cards/search?q=${encodeURIComponent('is:gamechanger')}&page=${page}`
        ),
        deadline,
      ]);
      for (const card of response.data) {
        names.add(card.name);
        // For DFCs, also index by front face so EDHREC name lookups match
        if (card.name.includes(' // ')) {
          names.add(frontFaceName(card.name));
        }
      }
      hasMore = response.has_more;
      page++;
    } catch {
      completedFully = false;
      break;
    }
  }
  clearTimeout(timer);

  if (names.size === 0) {
    // First-page network failure → fall back to hardcoded list so the live path
    // also degrades gracefully rather than zeroing the GC floor.
    logger.debug('[Scryfall] GC live fetch returned empty; using hardcoded fallback');
    gameChangerNamesCache = new Set(HARDCODED_GAME_CHANGERS);
    completedFully = false;
  } else if (completedFully) {
    // Every page landed — the live list is the current RC list, full stop.
    // Log drift (a hardcoded name the live list lacks) rather than silently
    // floor it, so a stale hardcoded copy shows up before someone hits it.
    const stale = [...HARDCODED_GAME_CHANGERS].filter((n) => !names.has(n));
    if (stale.length > 0) {
      logger.debug(
        `[Scryfall] hardcoded GC list has ${stale.length} card(s) the live list no longer does (drift): ${stale.join(', ')}`
      );
    }
    gameChangerNamesCache = names;
    writeGameChangerSnapshot(names);
  } else {
    // Partial live set (pagination broke mid-way) — union with the hardcoded
    // floor so a page that never arrived can't undercount the GC set.
    gameChangerNamesCache = new Set([...HARDCODED_GAME_CHANGERS, ...names]);
  }
  // Only a complete live list counts as fresh: after a failure or partial result the
  // floor answers meanwhile and the next caller tries the fetch again.
  if (completedFully) gameChangerCacheTimestamp = Date.now();
  logger.debug(`[Scryfall] Cached ${gameChangerNamesCache.size} game changer card names`);
  return gameChangerNamesCache;
}

/**
 * Offline game-changer names: seeded from the hardcoded Feb 2026 RC list so
 * native/offline users get correct GC floors without a network call.
 */
export async function offlineGetGameChangerNames(): Promise<Set<string>> {
  if (gameChangerNamesCache && Date.now() - gameChangerCacheTimestamp < GC_CACHE_TTL) {
    return gameChangerNamesCache;
  }
  // Seed from the hardcoded Feb 2026 RC list so native/offline users get
  // correct GC floors without a network call.
  gameChangerNamesCache = new Set(HARDCODED_GAME_CHANGERS);
  gameChangerCacheTimestamp = Date.now();
  return gameChangerNamesCache;
}

/** What `getGameChangerNamesNow` answers with, and whether the in-memory list is still fresh. */
export function peekGameChangerNames(): { known: Set<string>; fresh: boolean } {
  const fresh =
    gameChangerNamesCache !== null && Date.now() - gameChangerCacheTimestamp < GC_CACHE_TTL;
  return {
    known: gameChangerNamesCache ?? readGameChangerSnapshot() ?? new Set(HARDCODED_GAME_CHANGERS),
    fresh,
  };
}
