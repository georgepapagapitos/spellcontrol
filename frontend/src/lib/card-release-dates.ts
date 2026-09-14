/**
 * Device-local per-printing release-date cache, keyed by Scryfall printing id
 * (`scryfallId`).
 *
 * A printing's release date is GLOBAL reference data — the same for everyone,
 * sourced from Scryfall — NOT per-user data, so it must never ride the per-user
 * sync path. This is the same call prices made (see [[card-prices]]): putting
 * global data on the synced `EnrichedCard` row meant a refresh of a ~12k
 * collection re-uploaded every row and re-pulled it on every other device.
 *
 * Unlike a price, a release date is IMMUTABLE — a printing shipped on the day
 * it shipped. So there is no TTL, no staleness pass and no refetch: once a
 * printing's date is cached it is correct forever. Entries arrive alongside the
 * price refresh, which is already the one request that walks a whole collection
 * by printing id.
 *
 * Why this exists at all: the binder Release-date sort used to date every card
 * from its SET, and a rolling container set's date is a lie for nearly
 * everything in it — `SLD` files 2,755 printings under 2019-12-02, `PLST` (The
 * List) 5,663 under 2020-09-26, `PRM` 3,094. `releaseDateOf` in
 * @spellcontrol/binder-routing prefers `EnrichedCard.releasedAt` over both the
 * Secret Lair drop map and the set date.
 *
 * ponytail: localStorage-backed, mirroring the price cache — one keyed map,
 * loaded once at boot, rewritten on change. A date is ~11 bytes of payload and
 * ~50 with its key and JSON overhead, so a 13k-printing library is ~650KB,
 * inside the ~5MB quota and the same tradeoff the price cache already accepted.
 * If it ever janks on a huge library, move to the device-local offline IDB
 * (`spellcontrol-offline`) where the rest of the reference data lives. See
 * [[project_offline_vs_sync_caches]].
 */

import { useMemo } from 'react';
import type { EnrichedCard, SortEntry } from '@spellcontrol/binder-routing';

const LS_KEY = 'spellcontrol:card-release-dates';

let cache = new Map<string, string>();
let loaded = false;

/** Load the cache from localStorage into memory. Idempotent; call once at boot. */
export function loadReleaseDates(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) cache = new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    cache = new Map();
  }
}

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    /* quota / unavailable — dates are a refreshable nicety, never critical */
  }
}

/**
 * Merge fetched dates (keyed by scryfallId) into the device cache.
 *
 * Only writes localStorage when something actually changed. That matters more
 * here than for prices: dates are immutable, so every refresh after the first
 * re-sends values we already hold, and re-serializing a 13k-entry map on each
 * one would jank for no gain.
 */
export function setReleaseDates(entries: Record<string, string>): void {
  loadReleaseDates();
  let changed = false;
  for (const [id, date] of Object.entries(entries)) {
    if (!date || cache.get(id) === date) continue;
    cache.set(id, date);
    changed = true;
  }
  if (changed) persist();
}

export function getReleaseDate(scryfallId: string): string | undefined {
  loadReleaseDates();
  return cache.get(scryfallId);
}

/** Test-only: reset the in-memory cache + loaded flag. */
export function _resetForTests(): void {
  cache = new Map();
  loaded = false;
}

/**
 * Stamp `releasedAt` onto every card we hold a date for, so the binder engine
 * dates each printing individually. Reference decoration exactly like the otag
 * `tags` and Secret Lair `sldDrop` fields: never persisted or synced, applied
 * just before materializing.
 *
 * Returns the input array by identity when nothing is cached yet, so a cold
 * cache degrades to the set/drop-date behaviour and a `useMemo` over the result
 * doesn't invalidate for collections this can't affect.
 */
export function decorateReleaseDates<T extends { scryfallId?: string }>(cards: T[]): T[] {
  loadReleaseDates();
  if (cache.size === 0) return cards;
  let touched = false;
  const out = cards.map((card) => {
    const date = card.scryfallId ? cache.get(card.scryfallId) : undefined;
    if (!date) return card;
    touched = true;
    return { ...card, releasedAt: date };
  });
  return touched ? out : cards;
}

/**
 * True when any binder sorts by release date — the gate for decorating. Unlike
 * the Secret Lair drop map this is NOT needed by the `setName` sort: a
 * printing's date never changes which set it belongs to.
 */
export function bindersUseReleaseDates(binders: { sorts?: SortEntry[] }[]): boolean {
  return binders.some((b) => b.sorts?.some((s) => s?.field === 'setReleaseDate'));
}

/**
 * Cards decorated with their own printing's release date. When `usesDates` is
 * false, returns `cards` by reference — zero cost. Mirrors
 * `useCardsWithSldDrops`; pass `bindersUseReleaseDates(binders)`.
 */
export function useCardsWithReleaseDates(
  cards: EnrichedCard[],
  usesDates: boolean
): EnrichedCard[] {
  return useMemo(() => (usesDates ? decorateReleaseDates(cards) : cards), [cards, usesDates]);
}
