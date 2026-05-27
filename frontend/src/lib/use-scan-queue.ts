import { useCallback, useMemo, useRef, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ScannedEntry } from '../components/ScannerQueueSheet';

/**
 * Outcome of an `addScan` call. The caller uses this to decide whether
 * to fire the user-feedback side effects (chime, haptic, value-pulse,
 * "last scan" panel): 'duplicate' suppresses everything, 'accepted'
 * lets it through. The added-vs-incremented distinction is intentionally
 * NOT exposed — the scanner UX treats both the same way.
 */
export type AddScanResult = 'accepted' | 'duplicate';

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
   * the same one. Queue entries are keyed by `oracle_id`, so different
   * printings of the same card collapse into a single row.
   */
  addScan: (card: ScryfallCard) => AddScanResult;
  /** Remove an entry by id. Also clears the dedupe cursor. */
  removeFromQueue: (id: string) => void;
  /** Wipe the queue and clear the dedupe cursor. */
  clearQueue: () => void;
  /** Adjust qty by ±delta; rows that hit qty ≤ 0 are removed. */
  changeQty: (id: string, delta: number) => void;
  /** Swap the ScryfallCard for an entry (alt-printing picker). */
  changePrinting: (id: string, newCard: ScryfallCard) => void;
  /**
   * Bump the qty of an existing entry by its oracle id. No-op if the
   * entry isn't present. Used by the "+1" affordance on the bottom
   * card panel, which targets the last-scanned card regardless of
   * whether the user has since removed it from the queue.
   */
  incrementByOracleId: (oracleId: string) => void;
}

/**
 * Owns the scanner's queue of identified cards plus the dedupe cursor.
 *
 * The dedupe cursor (`lastIdRef`) is the printing id of the most recent
 * accepted scan. When the matcher returns the same printing twice in a
 * row, the second hit is silently skipped — without this, a still card
 * in front of the camera would re-add itself every capture cycle.
 *
 * Queue entries are keyed by `oracle_id`, not by printing id: scanning
 * a Sol Ring from Commander 2014 followed by a Sol Ring from a Secret
 * Lair drop produces a single row with qty 2, not two rows. The user
 * can swap the printing on the row via the queue sheet.
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
      const p = entry.card.prices;
      const raw = p?.usd ?? p?.usd_foil ?? p?.usd_etched ?? null;
      const value = raw ? Number.parseFloat(raw) : NaN;
      if (Number.isFinite(value)) sum += value * entry.qty;
    }
    return sum;
  }, [queue]);

  const addScan = useCallback((card: ScryfallCard): AddScanResult => {
    if (lastIdRef.current === card.id) return 'duplicate';
    lastIdRef.current = card.id;
    setQueue((prev) => {
      const existing = prev.find((e) => e.id === card.oracle_id);
      if (existing) {
        return prev.map((e) => (e.id === card.oracle_id ? { ...e, qty: e.qty + 1 } : e));
      }
      return [...prev, { id: card.oracle_id, card, qty: 1, rawText: card.name }];
    });
    return 'accepted';
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
    setQueue((prev) => prev.map((e) => (e.id === id ? { ...e, card: newCard } : e)));
  }, []);

  const incrementByOracleId = useCallback((oracleId: string) => {
    setQueue((prev) => {
      const existing = prev.find((e) => e.id === oracleId);
      if (!existing) return prev;
      return prev.map((e) => (e.id === oracleId ? { ...e, qty: e.qty + 1 } : e));
    });
  }, []);

  return {
    queue,
    totalCount,
    totalPrice,
    addScan,
    removeFromQueue,
    clearQueue,
    changeQty,
    changePrinting,
    incrementByOracleId,
  };
}
