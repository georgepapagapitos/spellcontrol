import { useEffect, useMemo, useState } from 'react';
import type { SortEntry } from '@spellcontrol/binder-routing';

/**
 * Secret Lair drop identification (E140). Scryfall lumps every Secret Lair
 * printing into the single flat `SLD` set, so which *drop* a card came from
 * is invisible to set metadata. `public/sld-drops.json` (built by
 * `scripts/refresh-sld-drops.mjs` from MTGJSON's sealed-product data) maps
 * each drop to its SLD collector numbers; this module loads it once per
 * page-load and answers "which drop(s) is this number from?".
 */

export const SLD_CODE = 'SLD';

/** Sentinel `?drop=` value for owned SLD cards not mapped to any drop. */
export const SLD_UNASSIGNED = '__unassigned';

export interface SldDrop {
  name: string;
  /** YYYY-MM-DD of the drop's first SKU; '' when unknown. */
  releasedAt: string;
  /** SLD collector numbers in this drop (checklist slots). */
  numbers: string[];
}

export interface SldDropsIndex {
  /** Newest release first (snapshot order). */
  drops: SldDrop[];
  byNumber: Map<string, SldDrop[]>;
}

/**
 * Base collector number for variant matching: "1627★" / "119a" → "1627" /
 * "119". Foil-variant printings share the drop of their base number.
 */
export function baseCollectorNumber(number: string): string {
  return number.replace(/[^0-9]+$/, '');
}

/** Validate + index the snapshot JSON. Returns null on any shape surprise. */
export function parseSldDrops(json: unknown): SldDropsIndex | null {
  const drops = (json as { drops?: unknown })?.drops;
  if (!Array.isArray(drops)) return null;
  const clean: SldDrop[] = [];
  const byNumber = new Map<string, SldDrop[]>();
  for (const d of drops) {
    const drop = d as Partial<SldDrop>;
    if (typeof drop.name !== 'string' || !Array.isArray(drop.numbers)) return null;
    const entry: SldDrop = {
      name: drop.name,
      releasedAt: typeof drop.releasedAt === 'string' ? drop.releasedAt : '',
      numbers: drop.numbers.map(String),
    };
    clean.push(entry);
    for (const n of entry.numbers) {
      const list = byNumber.get(n);
      if (list) list.push(entry);
      else byNumber.set(n, [entry]);
    }
  }
  return { drops: clean, byNumber };
}

/**
 * The drop(s) an SLD collector number belongs to — usually one; a handful of
 * numbers were sold in more than one drop (e.g. the Dan Frazier Talisman
 * pairs). Falls back to the base number for suffixed variants ("1627★").
 */
export function dropsForNumber(index: SldDropsIndex, collectorNumber: string): SldDrop[] {
  const exact = index.byNumber.get(collectorNumber);
  if (exact) return exact;
  const base = baseCollectorNumber(collectorNumber);
  return (base !== collectorNumber && index.byNumber.get(base)) || [];
}

/**
 * Stamp `sldDrop`/`sldDropReleasedAt` onto every SLD card so the binder engine
 * can section by drop. Reference decoration, exactly like the otag `tags`
 * field: never persisted or synced, applied just before materializing.
 *
 * Returns the input array by identity when the drop map is unavailable or the
 * collection holds no mappable Secret Lair cards — so an unloaded snapshot
 * degrades to today's flat-SLD behavior, and a `useMemo` over the result
 * doesn't invalidate for collections this can't affect.
 *
 * A number sold in more than one drop (the Dan Frazier Talisman pairs) takes
 * the first: a physical card can only sit in one binder section.
 */
export function decorateSldDrops<T extends { setCode: string; collectorNumber: string }>(
  cards: T[],
  index: SldDropsIndex | null | undefined
): T[] {
  if (!index) return cards;
  let touched = false;
  const out = cards.map((card) => {
    if (card.setCode?.toUpperCase() !== SLD_CODE) return card;
    const drop = dropsForNumber(index, card.collectorNumber)[0];
    if (!drop) return card;
    touched = true;
    return { ...card, sldDrop: drop.name, sldDropReleasedAt: drop.releasedAt };
  });
  return touched ? out : cards;
}

let sldDropsPromise: Promise<SldDropsIndex | null> | null = null;

/**
 * Loads the drop map once per page-load. Resolves to null when the snapshot
 * is missing/unparseable (callers degrade to today's flat-SLD behavior); a
 * network failure resets the cache so a later call can retry.
 */
export function getSldDrops(): Promise<SldDropsIndex | null> {
  if (!sldDropsPromise) {
    sldDropsPromise = fetch('/sld-drops.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => (json ? parseSldDrops(json) : null))
      .catch(() => {
        sldDropsPromise = null;
        return null;
      });
  }
  return sldDropsPromise;
}

/**
 * True when any binder sorts by set — the gate for decorating. Either set sort
 * resolves a Secret Lair to its drop (binder-routing `setMeta`), so both need
 * the decoration; `sldDrop` is the retired field name, still stored on binders
 * saved before the fold (see `normalizeSorts`).
 */
export function bindersUseSldDrops(binders: { sorts: SortEntry[] }[]): boolean {
  return binders.some((b) =>
    b.sorts?.some(
      (s) =>
        s?.field === 'setName' ||
        s?.field === 'setReleaseDate' ||
        (s?.field as string) === 'sldDrop'
    )
  );
}

/**
 * Cards decorated with their Secret Lair drop, recomputed when the snapshot
 * loads. When `usesDrops` is false, returns `cards` by reference — zero cost.
 * Mirrors `useCardsWithTags`; pass `bindersUseSldDrops(binders)`.
 */
export function useCardsWithSldDrops<T extends { setCode: string; collectorNumber: string }>(
  cards: T[],
  usesDrops: boolean
): T[] {
  const index = useSldDrops();
  return useMemo(
    () => (usesDrops ? decorateSldDrops(cards, index) : cards),
    [cards, usesDrops, index]
  );
}

/** React hook for the drop map: undefined while loading, null if unavailable. */
export function useSldDrops(): SldDropsIndex | null | undefined {
  const [index, setIndex] = useState<SldDropsIndex | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    getSldDrops().then((i) => {
      if (!cancelled) setIndex(i);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return index;
}
