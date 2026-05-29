import { useCallback, useMemo, useRef, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import type { ScannedEntry } from '../components/ScannerQueueSheet';
import { availableFinishes, finishUnitPrice } from './scanner-feedback';

/**
 * Outcome of an `addScan` call. The caller uses this to decide whether
 * to fire the user-feedback side effects (chime, haptic, value-pulse,
 * "last scan" panel): 'duplicate' suppresses everything, 'accepted'
 * lets it through. The added-vs-incremented distinction is intentionally
 * NOT exposed — the scanner UX treats both the same way.
 */
export type AddScanResult = 'accepted' | 'duplicate';

/**
 * Row identity. A foil and a nonfoil copy of the same card are distinct
 * collection items (different value), so the queue keys on `oracle_id +
 * finish` — they occupy separate rows. Different *printings* of the same
 * card+finish still collapse (finish, not set, is what splits a row).
 */
export function entryKey(oracleId: string, finish: Finish): string {
  return `${oracleId}::${finish}`;
}

/**
 * Add-or-increment a scanned card into the queue. Scans always land as
 * nonfoil — the matcher can't read finish from a photo, so the user opts into
 * foil/etched via the toggle afterward. Pure — the dedupe-cursor bookkeeping
 * lives in the callers.
 */
function upsertCard(queue: ScannedEntry[], card: ScryfallCard): ScannedEntry[] {
  const finish: Finish = 'nonfoil';
  const id = entryKey(card.oracle_id, finish);
  const existing = queue.find((e) => e.id === id);
  if (existing) {
    return queue.map((e) => (e.id === id ? { ...e, qty: e.qty + 1 } : e));
  }
  return [...queue, { id, card, qty: 1, finish, rawText: card.name }];
}

/**
 * Apply a card and/or finish change to one row. Because identity depends on
 * `oracle_id + finish`, this re-keys the row; if a row of the new identity
 * already exists (e.g. toggling a nonfoil row to foil when a foil row is
 * already present) the two are merged rather than left as duplicates. The
 * requested finish is clamped to one the printing actually offers, so we
 * never emit an impossible foil row on import.
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
  const newId = entryKey(card.oracle_id, finish);
  const mergeIdx = queue.findIndex((e, i) => i !== idx && e.id === newId);
  if (mergeIdx >= 0) {
    return queue
      .map((e, i) => (i === mergeIdx ? { ...e, qty: e.qty + cur.qty } : e))
      .filter((_, i) => i !== idx);
  }
  return queue.map((e, i) => (i === idx ? { ...cur, id: newId, card, finish } : e));
}

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
   * the same one. New scans land as a nonfoil row keyed by `oracle_id +
   * finish` (see {@link entryKey}); different printings of the same
   * card+finish collapse into one row.
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
  addManual: (card: ScryfallCard) => void;
  /** Remove an entry by id. Also clears the dedupe cursor. */
  removeFromQueue: (id: string) => void;
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
   * Set the owned finish (nonfoil / foil / etched) for an entry. Re-keys the
   * row by `oracle_id + finish`, merging into an existing same-finish row if
   * one is present.
   */
  changeFinish: (id: string, finish: Finish) => void;
}

/**
 * Owns the scanner's queue of identified cards plus the dedupe cursor.
 *
 * The dedupe cursor (`lastIdRef`) is the printing id of the most recent
 * accepted scan. When the matcher returns the same printing twice in a
 * row, the second hit is silently skipped — without this, a still card
 * in front of the camera would re-add itself every capture cycle.
 *
 * Queue entries are keyed by `oracle_id + finish` (see {@link entryKey}):
 * scanning a Sol Ring from Commander 2014 then a Sol Ring from a Secret Lair
 * drop produces a single nonfoil row with qty 2 (printing doesn't split a
 * row), but a foil and a nonfoil Sol Ring are two rows. The user can swap the
 * printing or toggle the finish on a row via the queue sheet / panel.
 */
export function useScanQueue(): UseScanQueueResult {
  const [queue, setQueue] = useState<ScannedEntry[]>([]);
  /**
   * Printing id of the last accepted scan, used to dedupe back-to-back
   * identical captures. Lives in a ref so reading/writing it doesn't
   * trigger a re-render and the value is current inside `addScan`'s
   * synchronous check.
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

  const addScan = useCallback((card: ScryfallCard, force = false): AddScanResult => {
    if (!force && lastIdRef.current === card.id) return 'duplicate';
    lastIdRef.current = card.id;
    setQueue((prev) => upsertCard(prev, card));
    return 'accepted';
  }, []);

  const addManual = useCallback((card: ScryfallCard) => {
    // A manual add interleaves with live scanning; clear the cursor so the
    // matcher's "same card still in frame" dedupe restarts cleanly.
    lastIdRef.current = null;
    setQueue((prev) => upsertCard(prev, card));
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((s) => s.id !== id));
    lastIdRef.current = null;
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    lastIdRef.current = null;
  }, []);

  const changeQty = useCallback((id: string, delta: number) => {
    setQueue((prev) =>
      prev.map((e) => (e.id === id ? { ...e, qty: e.qty + delta } : e)).filter((e) => e.qty > 0)
    );
  }, []);

  const changePrinting = useCallback((id: string, newCard: ScryfallCard) => {
    setQueue((prev) => applyEntryPatch(prev, id, { card: newCard }));
  }, []);

  const changeFinish = useCallback((id: string, finish: Finish) => {
    setQueue((prev) => applyEntryPatch(prev, id, { finish }));
  }, []);

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
  };
}
