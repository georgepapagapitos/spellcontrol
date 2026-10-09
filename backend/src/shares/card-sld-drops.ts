/**
 * Server-side Secret Lair drop lookup for shared-binder projections — the
 * mirror of the frontend's `lib/sld-drops.ts`, exactly as `card-tags.ts`
 * mirrors its otag decoration.
 *
 * A binder sorted by Set or Release date sections a Secret Lair by its *drop*
 * (`EnrichedCard.sldDrop`, stamped on just before materializing — never
 * persisted). Without this the shared view of that binder showed one flat
 * "Secret Lair Drop" section and dated every SLD card "unknown", so the owner
 * and the person they shared with saw two different orders.
 *
 * Same snapshot-on-disk trick as the tags: Vite copies `public/sld-drops.json`
 * into the frontend `dist`, which the Dockerfile copies to `backend/public`.
 * Missing in dev/test → no decoration, flat-SLD behavior, never an error.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pickClosestDrop, type EnrichedCard } from '@spellcontrol/binder-routing';

const SNAPSHOT_PATH =
  process.env.SLD_DROPS_SNAPSHOT_PATH ??
  path.join(__dirname, '..', '..', 'public', 'sld-drops.json');

interface Drop {
  name: string;
  releasedAt: string;
}

let byNumber: Map<string, Drop[]> | null = null;

function ensureLoaded(): Map<string, Drop[]> {
  if (byNumber) return byNumber;
  byNumber = new Map();
  try {
    const data = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
      drops?: { name?: unknown; releasedAt?: unknown; numbers?: unknown }[];
    };
    for (const d of data.drops ?? []) {
      if (typeof d.name !== 'string' || !Array.isArray(d.numbers)) continue;
      const drop = {
        name: d.name,
        releasedAt: typeof d.releasedAt === 'string' ? d.releasedAt : '',
      };
      // Snapshot order (newest first) is kept: a number sold in more than one drop is
      // resolved per card by `pickClosestDrop`, exactly as the frontend does.
      for (const n of d.numbers) {
        const list = byNumber.get(String(n));
        if (list) list.push(drop);
        else byNumber.set(String(n), [drop]);
      }
    }
  } catch {
    // No snapshot on disk (dev/test) — Secret Lairs keep the flat set. Not an error.
  }
  return byNumber;
}

/** Cheap walk of raw binder JSONB: does any binder sort by set or release date? */
export function anyBinderUsesSetSorts(bindersRaw: unknown): boolean {
  if (!Array.isArray(bindersRaw)) return false;
  return bindersRaw.some((b) => {
    const sorts = (b as { sorts?: unknown })?.sorts;
    return (
      Array.isArray(sorts) &&
      sorts.some((s) => {
        const f = (s as { field?: unknown })?.field;
        return f === 'setName' || f === 'setReleaseDate' || f === 'sldDrop';
      })
    );
  });
}

/**
 * Stamp `sldDrop` / `sldDropReleasedAt` onto mapped SLD cards (copies only those).
 * Run AFTER `decorateCardsWithReleaseDates`: the closest-dated drop needs `releasedAt`.
 */
export function decorateCardsWithSldDrops(cards: EnrichedCard[]): EnrichedCard[] {
  const index = ensureLoaded();
  if (index.size === 0) return cards;
  return cards.map((c) => {
    if ((c.setCode ?? '').toUpperCase() !== 'SLD') return c;
    const n = c.collectorNumber ?? '';
    // Suffixed variants ("1627★") share their base number's drop.
    const candidates = index.get(n) ?? index.get(n.replace(/[^0-9]+$/, '')) ?? [];
    const drop = pickClosestDrop(candidates, c.releasedAt);
    return drop ? { ...c, sldDrop: drop.name, sldDropReleasedAt: drop.releasedAt } : c;
  });
}

/** Test seam: drop the cached index so a changed snapshot path is re-read. */
export function resetSldDropsCache(): void {
  byNumber = null;
}
