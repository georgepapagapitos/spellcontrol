import { useEffect, useState } from 'react';
import { getCardsByIds, getCardsByNames } from '@/deck-builder/services/scryfall/client';
import type { ScryfallCard } from '@/deck-builder/types';

/**
 * Resolve a card name to its image off the **CDN** (`cards.scryfall.io`), never
 * the rate-limited API host.
 *
 * The trap this replaces: a bare `<img src="https://api.scryfall.com/cards/
 * named?…&format=image">` is NOT a free CDN redirect — it's a request to the
 * throttled API host (~10 req/s), so a panel that mounts dozens of name-only
 * rows at once (the Tune/Power suggestion lanes) bursts straight into HTTP 429.
 * The fix is to resolve the card first — through the in-memory + offline-IDB
 * cache, batched 75-at-a-time via `/cards/collection` only when truly uncached —
 * and render its `image_uris`, which point at the un-throttled CDN.
 *
 * Resolution is micro-batched: every `useCardThumb` mounted in the same tick
 * (e.g. one render of a 45-row Improve lane) coalesces into a single
 * `getCardsByNames` call, so the network sees one batched request, not N.
 */

export type ThumbVersion = 'small' | 'normal' | 'large' | 'art_crop';

/** Pull the requested image size off a resolved card, falling back to the front
 *  face for DFCs/MDFCs (which carry art per-face, not at the top level). */
export function imageFromCard(
  card: ScryfallCard,
  version: ThumbVersion = 'normal'
): string | undefined {
  return card.image_uris?.[version] ?? card.card_faces?.[0]?.image_uris?.[version];
}

// lowercased name -> resolved card (null = looked up and not found; cached so a
// miss never re-hits the network within a session).
const cache = new Map<string, ScryfallCard | null>();
let queue = new Set<string>();
let flushing: Promise<void> | null = null;

/** Drain the queued names in one batched `getCardsByNames` call on the next
 *  microtask, so synchronously-mounted rows coalesce into a single request. */
function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = new Promise<void>((resolve) => {
    queueMicrotask(async () => {
      const names = [...queue];
      // Reset BEFORE awaiting so names requested during the fetch start a fresh
      // batch instead of getting silently dropped.
      queue = new Set();
      flushing = null;
      if (names.length > 0) {
        try {
          const found = await getCardsByNames(names);
          for (const n of names) cache.set(n.toLowerCase(), found.get(n) ?? null);
        } catch {
          // Whole batch failed — cache misses so we degrade to a skeleton rather
          // than retry-storm. A later session (fresh cache) can try again.
          for (const n of names) cache.set(n.toLowerCase(), null);
        }
      }
      resolve();
    });
  });
  return flushing;
}

/** Resolve one card by name (cache-first, batched). Returns null on a miss. */
export async function loadCard(name: string): Promise<ScryfallCard | null> {
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  queue.add(name);
  await flush();
  return cache.get(key) ?? null;
}

/**
 * Synchronous cache read: the image URL already resolved for `name`, or
 * undefined. Exported because some callers are not renders — the playtest
 * hover preview resolves a card id at POINTER time, long after the surface
 * that rendered it (and warmed this cache through `useCardThumb`) painted.
 */
export function cachedCardThumb(
  name: string,
  version: ThumbVersion = 'normal'
): string | undefined {
  const card = cache.get(name.toLowerCase());
  return card ? imageFromCard(card, version) : undefined;
}

/**
 * Resolve `name` to a CDN image URL, or `undefined` while loading / on a miss.
 * Pass `undefined`/empty to skip resolution (e.g. when an `imageUrl` is already
 * in hand) — callers render their own skeleton/placeholder for the undefined
 * window. Safe to call once per list row: requests micro-batch automatically.
 */
export function useCardThumb(
  name: string | undefined,
  version: ThumbVersion = 'normal'
): string | undefined {
  // Synchronous cache hit, derived during render — a warm cache paints art on
  // the first frame with no effect round-trip or flash.
  const cached = name ? cachedCardThumb(name, version) : undefined;
  const [resolved, setResolved] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!name || cached) return;
    let alive = true;
    void loadCard(name).then((card) => {
      if (alive) setResolved(card ? imageFromCard(card, version) : undefined);
    });
    return () => {
      alive = false;
    };
  }, [name, version, cached]);
  return cached ?? resolved;
}

// scryfall id -> resolved printing (null = looked up and not found). Same
// micro-batching as the name path, through `getCardsByIds`, which is itself
// cache-first (memory + offline IDB) and batches 75 per request.
const idCache = new Map<string, ScryfallCard | null>();
let idQueue = new Set<string>();
let idFlushing: Promise<void> | null = null;

function flushIds(): Promise<void> {
  if (idFlushing) return idFlushing;
  idFlushing = new Promise<void>((resolve) => {
    queueMicrotask(async () => {
      const ids = [...idQueue];
      idQueue = new Set();
      idFlushing = null;
      if (ids.length > 0) {
        try {
          const found = await getCardsByIds(ids);
          for (const id of ids) idCache.set(id, found.get(id) ?? null);
        } catch {
          for (const id of ids) idCache.set(id, null);
        }
      }
      resolve();
    });
  });
  return idFlushing;
}

/** Resolve one exact printing by Scryfall id (cache-first, batched). */
export async function loadPrinting(id: string): Promise<ScryfallCard | null> {
  if (idCache.has(id)) return idCache.get(id) ?? null;
  idQueue.add(id);
  await flushIds();
  return idCache.get(id) ?? null;
}

/**
 * Art for an EXACT printing. Resolves `scryfallId` first; when there is no id,
 * or it does not resolve (merged away, offline, not found), falls back to the
 * card by `name`. `id` is the printing the image really is: the scryfall id
 * when the pinned printing resolved, undefined for a name fallback, so a caller
 * can state honestly whether it is showing the printing or a stand-in.
 */
export function usePrintingThumb(
  scryfallId: string | undefined,
  name: string,
  version: ThumbVersion = 'normal'
): { src: string | undefined; id: string | undefined } {
  const pinnedCard = scryfallId ? idCache.get(scryfallId) : undefined;
  const [, bump] = useState(0);
  useEffect(() => {
    if (!scryfallId || idCache.has(scryfallId)) return;
    let alive = true;
    void loadPrinting(scryfallId).then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [scryfallId]);

  const pinnedSrc = pinnedCard ? imageFromCard(pinnedCard, version) : undefined;
  // The name path is only needed once the id lookup has settled without art
  // (or there never was an id), so a pinned line does not also fetch by name.
  const settled = !scryfallId || idCache.has(scryfallId);
  const byName = useCardThumb(settled && !pinnedSrc ? name : undefined, version);
  if (pinnedSrc) return { src: pinnedSrc, id: scryfallId };
  return { src: byName, id: undefined };
}

/** Test-only: clear the module-level resolution cache between cases. */
export function __resetCardThumbCacheForTests(): void {
  cache.clear();
  queue = new Set();
  flushing = null;
  idCache.clear();
  idQueue = new Set();
  idFlushing = null;
}
