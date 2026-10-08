import { useCallback, useMemo, useRef } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/util/safe-local-storage';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Condition, Finish } from '@/types/index';
import { availableFinishes, finishUnitPrice } from './scanner-feedback';
import { useScannerSettings } from './scanner-settings';

/**
 * Where a row came from: the camera matcher/scanner's own "Add by name", or
 * the Add-cards sheet's Search tab / printing picker (T153). Only used to
 * decide the commit's import-history label (see `scan-import.ts`) — the two
 * origins share one list and one commit path. Missing on a queue persisted
 * before this field existed, which reads as 'scanned' (its only origin then).
 */
export type EntrySource = 'scanned' | 'searched';

export interface ScannedEntry {
  /** Stable row id = printing id + finish (see {@link entryKey}), so a foil
   *  and a nonfoil copy of the same card are distinct rows, and so are two
   *  different printings, each keeping its own set/collector. */
  id: string;
  card: ScryfallCard;
  qty: number;
  /** Owned finish for this row. Round-trips to the collection as a
   *  foil/etched copy via the import text. */
  finish: Finish;
  /**
   * Owned condition for this row (E87). Undefined means Near Mint, the
   * unmarked default, matching the collection's "norms are unmarked"
   * convention (STYLE_GUIDE § Card row information hierarchy). Unlike
   * `finish`, condition is NOT part of row identity (see `entryKey`): it
   * applies uniformly to the row's whole `qty` stack. Round-trips to the
   * collection via the import text.
   */
  condition?: Condition;
  /**
   * Scryfall printed-language code (T153), e.g. 'ja'. Undefined means
   * English, the unmarked default (§ Copy details) — matches `condition`'s
   * convention. Round-trips to the collection via the import CSV.
   */
  language?: string;
  /** Where this row came from (see {@link EntrySource}). Undefined on a
   *  queue persisted before this field existed. */
  source?: EntrySource;
  /** The card's name when the row was made. Kept for queues persisted before
   *  the redesign; nothing reads it. */
  rawText: string;
  /**
   * Epoch ms of the row's latest scan or add. Orders the list newest first
   * and drives "Just now". A repeat scan bumps it, so a stack you're adding
   * to rises back to the top. Optional: queues persisted before it existed
   * read as 0 (oldest).
   */
  addedAt?: number;
}

/** What a new row starts as: the scanner settings' defaults. */
interface NewRowDefaults {
  finish: Finish;
  condition: Condition;
  language: string;
}

/** Explicit overrides for one add, e.g. the printing picker's chosen finish,
 *  condition, language and quantity. Any field left out falls back to the
 *  Add settings default, exactly like a quick add. */
export interface AddOptions {
  finish?: Finish;
  condition?: Condition;
  language?: string;
  qty?: number;
  source?: EntrySource;
}

/**
 * Outcome of an `addScan` call. The caller uses this to decide whether
 * to fire the user-feedback side effects (chime, haptic, value-pulse,
 * "last scan" panel): 'duplicate' suppresses everything, 'accepted'
 * lets it through. The added-vs-incremented distinction is intentionally
 * NOT exposed — the scanner UX treats both the same way.
 */
export type AddScanResult = 'accepted' | 'duplicate';

/**
 * Row identity. Keys on `printing id + finish`: a foil and a nonfoil copy
 * are distinct collection items (different value), and so are two different
 * printings of the same card — each row carries its own set/collector number
 * into the import, so collapsing printings would silently discard real data.
 * Only genuinely identical scans (same printing, same finish) share a row.
 */
export function entryKey(printingId: string, finish: Finish): string {
  return `${printingId}::${finish}`;
}

/**
 * The id a row ends up with after a finish or printing change: the finish is
 * clamped to what the printing offers, exactly as `applyEntryPatch` does. A
 * sheet showing that row uses it to keep pointing at the right one.
 */
export function rekeyedId(card: ScryfallCard, finish: Finish): string {
  const allowed = availableFinishes(card.finishes);
  return entryKey(card.id, allowed.includes(finish) ? finish : allowed[0]);
}

/**
 * Add-or-increment a card into the queue. A field left unset in `opts` falls
 * back to the Add settings default — the camera matcher can't read finish
 * from a photo, so its scans always land this way, clamped to one the
 * printing offers (a Foil default on a nonfoil-only card lands nonfoil).
 * Incrementing an existing row only bumps its qty and `addedAt`: it keeps
 * whatever condition/language/source it already had, never the new call's
 * (an explicit picker re-add of an already-queued printing+finish is still
 * just "one more", not a retroactive edit — use `patch`/`setCondition`/
 * `setLanguage` for that). Pure: the dedupe-cursor bookkeeping lives in the
 * callers.
 */
function upsertCard(
  queue: ScannedEntry[],
  card: ScryfallCard,
  opts: AddOptions,
  defaults: NewRowDefaults,
  now: number
): ScannedEntry[] {
  const allowed = availableFinishes(card.finishes);
  const requestedFinish = opts.finish ?? defaults.finish;
  const finish = allowed.includes(requestedFinish) ? requestedFinish : allowed[0];
  const id = entryKey(card.id, finish);
  const qty = opts.qty ?? 1;
  const existing = queue.find((e) => e.id === id);
  if (existing) {
    return queue.map((e) => (e.id === id ? { ...e, qty: e.qty + qty, addedAt: now } : e));
  }
  const conditionRaw = opts.condition ?? defaults.condition;
  const condition = conditionRaw === 'nm' ? undefined : conditionRaw;
  const language = (opts.language ?? defaults.language) || undefined;
  return [
    ...queue,
    {
      id,
      card,
      qty,
      finish,
      condition,
      language,
      rawText: card.name,
      addedAt: now,
      source: opts.source,
    },
  ];
}

/**
 * Apply a card and/or finish change to one row. Because identity depends on
 * `printing id + finish`, this re-keys the row; if a row of the new identity
 * already exists (e.g. toggling a nonfoil row to foil when a foil row is
 * already present, or swapping a row's printing to one already queued) the
 * two are merged rather than left as duplicates. The requested finish is
 * clamped to one the printing actually offers, so we never emit an
 * impossible foil row on import.
 */
function applyEntryPatch(
  queue: ScannedEntry[],
  id: string,
  patch: { card?: ScryfallCard; finish?: Finish }
): ScannedEntry[] {
  const idx = queue.findIndex((e) => e.id === id);
  if (idx < 0) return queue;
  const cur = queue[idx];
  const card = patch.card ?? cur.card;
  const requested = patch.finish ?? cur.finish;
  const allowed = availableFinishes(card.finishes);
  const finish = allowed.includes(requested) ? requested : allowed[0];
  const newId = entryKey(card.id, finish);
  const mergeIdx = queue.findIndex((e, i) => i !== idx && e.id === newId);
  if (mergeIdx >= 0) {
    return queue
      .map((e, i) => (i === mergeIdx ? { ...e, qty: e.qty + cur.qty } : e))
      .filter((_, i) => i !== idx);
  }
  return queue.map((e, i) => (i === idx ? { ...cur, id: newId, card, finish } : e));
}

interface ScanQueueState {
  queue: ScannedEntry[];
  upsert: (card: ScryfallCard, opts?: AddOptions) => void;
  patch: (id: string, patch: { card?: ScryfallCard; finish?: Finish }) => void;
  /** Set one finish on several rows (select mode). Each row clamps to what its
   *  printing offers and may merge, exactly as a single `patch` would. */
  patchMany: (ids: string[], finish: Finish) => void;
  setCondition: (ids: string[], condition: Condition) => void;
  setLanguage: (ids: string[], language: string) => void;
  remove: (ids: string[]) => void;
  clear: () => void;
  changeQty: (id: string, delta: number) => void;
}

/** Read the settings at call time, not render time: a scan that lands right
 *  after the user changes a default should already use the new one. */
function currentDefaults(): NewRowDefaults {
  const s = useScannerSettings.getState();
  return { finish: s.defaultFinish, condition: s.defaultCondition, language: s.defaultLanguage };
}

/**
 * The scan queue lives in a persisted store rather than component state so it
 * survives the scanner unmounting — the user can leave the scanner to check
 * their collection and come back to the same queue, and an accidental app
 * kill mid-session doesn't lose their scans. It's cleared explicitly (the
 * "Clear all" button, per-row removal, or a successful add-to-collection),
 * never implicitly on close.
 *
 * Device-local only — this is pre-collection staging, not synced data (keep
 * it off the sync path, like the other reference/transient caches).
 */
export const useScanQueueStore = create<ScanQueueState>()(
  persist(
    (set) => ({
      queue: [],
      upsert: (card, opts) =>
        set((s) => ({
          queue: upsertCard(s.queue, card, opts ?? {}, currentDefaults(), Date.now()),
        })),
      patch: (id, p) => set((s) => ({ queue: applyEntryPatch(s.queue, id, p) })),
      patchMany: (ids, finish) =>
        set((s) => ({
          // Ids re-key as they go (printing + finish), so resolve each one
          // against the queue as it stands after the previous patch.
          queue: ids.reduce((q, id) => applyEntryPatch(q, id, { finish }), s.queue),
        })),
      // Condition isn't part of a row's identity (entryKey is printing+finish
      // only — see ScannedEntry.condition's doc comment), so unlike `patch`
      // this never re-keys or merges rows; it's a plain in-place update.
      // NM is stored as absent, the unmarked default.
      setCondition: (ids, condition) =>
        set((s) => ({
          queue: s.queue.map((e) =>
            ids.includes(e.id) ? { ...e, condition: condition === 'nm' ? undefined : condition } : e
          ),
        })),
      // Same shape as setCondition: language isn't part of row identity either,
      // so this is a plain in-place update. English ('') is stored as absent,
      // the unmarked default.
      setLanguage: (ids, language) =>
        set((s) => ({
          queue: s.queue.map((e) =>
            ids.includes(e.id) ? { ...e, language: language || undefined } : e
          ),
        })),
      remove: (ids) => set((s) => ({ queue: s.queue.filter((e) => !ids.includes(e.id)) })),
      clear: () => set({ queue: [] }),
      changeQty: (id, delta) =>
        set((s) => ({
          queue: s.queue
            .map((e) => (e.id === id ? { ...e, qty: e.qty + delta } : e))
            .filter((e) => e.qty > 0),
        })),
    }),
    {
      name: 'spellcontrol-scan-queue',
      storage: createJSONStorage(() => safeLocalStorage),
      // Persists the full ScryfallCard per row to localStorage. A
      // scan session is bounded (add-to-collection clears it), so size is a
      // non-issue; move to IndexedDB if sessions ever hold hundreds of cards.
    }
  )
);

export interface UseScanQueueResult {
  /** Current queue, in insertion order. */
  queue: ScannedEntry[];
  /** Sum of `qty` across all entries. */
  totalCount: number;
  /**
   * Sum of `qty × unit USD price`. Falls back to foil / etched when the
   * regular `usd` field is missing (Scryfall's convention). Memoised so
   * the topbar pill doesn't recalculate on every parent re-render.
   */
  totalPrice: number;
  /**
   * Try to add a scan to the queue. Dedupes against the most recently
   * accepted scan (by Scryfall printing id) — two consecutive scans of
   * the same physical card almost always mean the user is still framing
   * the same one. New scans land as the settings' default finish and
   * condition, keyed by `printing id + finish` (see {@link entryKey}); only
   * scans of the same printing and finish roll up into one row.
   *
   * Pass `force` for a deliberate, user-initiated capture (tap-to-rescan):
   * it bypasses the back-to-back dedupe so the same card increments, while
   * still parking the cursor on it so the *auto* loop won't then re-add it.
   */
  addScan: (card: ScryfallCard, force?: boolean) => AddScanResult;
  /**
   * Add a card chosen manually (via the in-scanner Scryfall search), not by
   * the camera matcher. Unlike {@link addScan} this never dedupes — every
   * call adds or increments, since an explicit search-and-tap is always an
   * intentional add — and it clears the auto-scan dedupe cursor so the live
   * matcher starts fresh on the next physical card.
   */
  addManual: (card: ScryfallCard, opts?: AddOptions) => void;
  /** Remove one entry or several (select mode). Also clears the dedupe cursor. */
  removeFromQueue: (ids: string | string[]) => void;
  /** Wipe the queue and clear the dedupe cursor. */
  clearQueue: () => void;
  /** Adjust qty by ±delta; rows that hit qty ≤ 0 are removed. */
  changeQty: (id: string, delta: number) => void;
  /**
   * Swap the ScryfallCard for an entry (alt-printing picker). Clamps the
   * row's finish to one the new printing actually offers.
   */
  changePrinting: (id: string, newCard: ScryfallCard) => void;
  /**
   * Set the owned finish (nonfoil / foil / etched) for one entry or several.
   * Re-keys each row by `printing id + finish`, merging into an existing
   * same-finish row if one is present, and clamps to what its printing offers.
   */
  changeFinish: (ids: string | string[], finish: Finish) => void;
  /**
   * Set the owned condition (nm/lp/mp/hp/damaged) for one entry or several
   * (E87). Unlike {@link changeFinish}, condition isn't part of row identity,
   * so this never re-keys or merges rows.
   */
  changeCondition: (ids: string | string[], condition: Condition) => void;
  /**
   * Set the owned printed-language for one entry or several (T153). Like
   * {@link changeCondition}, language isn't part of row identity, so this
   * never re-keys or merges rows. '' clears it back to the unmarked English
   * default.
   */
  changeLanguage: (ids: string | string[], language: string) => void;
}

/**
 * Owns the scanner's queue of identified cards plus the dedupe cursor.
 *
 * The dedupe cursor (`lastIdRef`) is the printing id of the most recent
 * accepted scan. When the matcher returns the same printing twice in a
 * row, the second hit is silently skipped — without this, a still card
 * in front of the camera would re-add itself every capture cycle.
 *
 * Queue entries are keyed by `printing id + finish` (see {@link entryKey}):
 * scanning a Sol Ring from Commander 2014 then a Sol Ring from a Secret Lair
 * drop produces two rows — each printing's set/collector number survives into
 * the import — and a foil and a nonfoil Sol Ring are likewise two rows. The
 * user can swap the printing or toggle the finish on a row via the queue
 * sheet / panel.
 */
const toIds = (ids: string | string[]): string[] => (Array.isArray(ids) ? ids : [ids]);

export function useScanQueue(): UseScanQueueResult {
  const queue = useScanQueueStore((s) => s.queue);
  const upsert = useScanQueueStore((s) => s.upsert);
  const patch = useScanQueueStore((s) => s.patch);
  const patchMany = useScanQueueStore((s) => s.patchMany);
  const setConditionAction = useScanQueueStore((s) => s.setCondition);
  const setLanguageAction = useScanQueueStore((s) => s.setLanguage);
  const remove = useScanQueueStore((s) => s.remove);
  const clear = useScanQueueStore((s) => s.clear);
  const changeQtyAction = useScanQueueStore((s) => s.changeQty);
  /**
   * Printing id of the last accepted scan, used to dedupe back-to-back
   * identical captures. Lives in a ref so reading/writing it doesn't
   * trigger a re-render and the value is current inside `addScan`'s
   * synchronous check. Deliberately NOT persisted: reopening the scanner
   * should accept the next scan even of a card already in the queue.
   */
  const lastIdRef = useRef<string | null>(null);

  const totalCount = useMemo(() => queue.reduce((sum, e) => sum + e.qty, 0), [queue]);

  const totalPrice = useMemo(() => {
    let sum = 0;
    for (const entry of queue) {
      const value = finishUnitPrice(entry.card.prices, entry.finish);
      if (value != null) sum += value * entry.qty;
    }
    return sum;
  }, [queue]);

  const addScan = useCallback(
    (card: ScryfallCard, force = false): AddScanResult => {
      if (!force && lastIdRef.current === card.id) return 'duplicate';
      lastIdRef.current = card.id;
      upsert(card, { source: 'scanned' });
      return 'accepted';
    },
    [upsert]
  );

  const addManual = useCallback(
    (card: ScryfallCard, opts?: AddOptions) => {
      // A manual add interleaves with live scanning; clear the cursor so the
      // matcher's "same card still in frame" dedupe restarts cleanly.
      lastIdRef.current = null;
      upsert(card, { source: 'scanned', ...opts });
    },
    [upsert]
  );

  const removeFromQueue = useCallback(
    (ids: string | string[]) => {
      remove(toIds(ids));
      lastIdRef.current = null;
    },
    [remove]
  );

  const clearQueue = useCallback(() => {
    clear();
    lastIdRef.current = null;
  }, [clear]);

  const changeQty = useCallback(
    (id: string, delta: number) => changeQtyAction(id, delta),
    [changeQtyAction]
  );

  const changePrinting = useCallback(
    (id: string, newCard: ScryfallCard) => patch(id, { card: newCard }),
    [patch]
  );

  const changeFinish = useCallback(
    (ids: string | string[], finish: Finish) => patchMany(toIds(ids), finish),
    [patchMany]
  );

  const changeCondition = useCallback(
    (ids: string | string[], condition: Condition) => setConditionAction(toIds(ids), condition),
    [setConditionAction]
  );

  const changeLanguage = useCallback(
    (ids: string | string[], language: string) => setLanguageAction(toIds(ids), language),
    [setLanguageAction]
  );

  return {
    queue,
    totalCount,
    totalPrice,
    addScan,
    addManual,
    removeFromQueue,
    clearQueue,
    changeQty,
    changePrinting,
    changeFinish,
    changeCondition,
    changeLanguage,
  };
}
