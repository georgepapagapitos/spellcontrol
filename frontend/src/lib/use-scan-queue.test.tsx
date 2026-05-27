// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScanQueue } from './use-scan-queue';
import type { ScryfallCard } from '@/deck-builder/types';

/**
 * Minimal ScryfallCard shape, matching the fields the hook actually
 * reads (`id`, `oracle_id`, `name`, `prices`). Everything else is cast
 * through so we don't have to round-trip the full type just to test
 * queue state.
 */
function makeCard(over: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'print-1',
    oracle_id: 'oracle-1',
    name: 'Sol Ring',
    prices: { usd: '2.00' },
    ...over,
  } as ScryfallCard;
}

describe('useScanQueue', () => {
  describe('initial state', () => {
    it('starts empty', () => {
      const { result } = renderHook(() => useScanQueue());
      expect(result.current.queue).toEqual([]);
      expect(result.current.totalCount).toBe(0);
      expect(result.current.totalPrice).toBe(0);
    });
  });

  describe('addScan', () => {
    it("returns 'accepted' for a new card and appends it with qty 1", () => {
      const { result } = renderHook(() => useScanQueue());
      const card = makeCard();
      let outcome: ReturnType<typeof result.current.addScan> | null = null;
      act(() => {
        outcome = result.current.addScan(card);
      });
      expect(outcome).toBe('accepted');
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0]).toMatchObject({
        id: 'oracle-1',
        qty: 1,
        rawText: 'Sol Ring',
      });
      expect(result.current.totalCount).toBe(1);
    });

    it("returns 'duplicate' when the same printing id is scanned twice in a row, leaving qty unchanged", () => {
      const { result } = renderHook(() => useScanQueue());
      const card = makeCard();
      act(() => {
        result.current.addScan(card);
      });
      let outcome: ReturnType<typeof result.current.addScan> | null = null;
      act(() => {
        outcome = result.current.addScan(card);
      });
      expect(outcome).toBe('duplicate');
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0].qty).toBe(1);
    });

    it('increments qty when a different printing of the same oracle id is scanned', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ id: 'print-1' }));
      });
      act(() => {
        // Different printing id (so it isn't a dedupe duplicate), same oracle id.
        result.current.addScan(makeCard({ id: 'print-2' }));
      });
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0].qty).toBe(2);
      expect(result.current.totalCount).toBe(2);
    });

    it('appends a second row for a different oracle id', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ id: 'print-1', oracle_id: 'oracle-1' }));
      });
      act(() => {
        result.current.addScan(
          makeCard({ id: 'print-2', oracle_id: 'oracle-2', name: 'Counterspell' })
        );
      });
      expect(result.current.queue).toHaveLength(2);
      expect(result.current.queue.map((e) => e.id)).toEqual(['oracle-1', 'oracle-2']);
    });

    it('allows re-adding the same printing after the dedupe cursor resets', () => {
      const { result } = renderHook(() => useScanQueue());
      const card = makeCard();
      act(() => {
        result.current.addScan(card);
      });
      // Removing the entry clears the dedupe cursor — same printing can now
      // be scanned again as a fresh "accepted" event.
      act(() => {
        result.current.removeFromQueue('oracle-1');
      });
      let outcome: ReturnType<typeof result.current.addScan> | null = null;
      act(() => {
        outcome = result.current.addScan(card);
      });
      expect(outcome).toBe('accepted');
      expect(result.current.queue).toHaveLength(1);
    });
  });

  describe('removeFromQueue', () => {
    it('removes the matching entry and is a no-op for unknown ids', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ oracle_id: 'oracle-a' }));
        result.current.addScan(makeCard({ id: 'print-b', oracle_id: 'oracle-b' }));
      });
      expect(result.current.queue).toHaveLength(2);
      act(() => {
        result.current.removeFromQueue('oracle-a');
      });
      expect(result.current.queue.map((e) => e.id)).toEqual(['oracle-b']);

      act(() => {
        result.current.removeFromQueue('does-not-exist');
      });
      expect(result.current.queue.map((e) => e.id)).toEqual(['oracle-b']);
    });
  });

  describe('clearQueue', () => {
    it('empties the queue and clears the dedupe cursor', () => {
      const { result } = renderHook(() => useScanQueue());
      const card = makeCard();
      act(() => {
        result.current.addScan(card);
      });
      act(() => {
        result.current.clearQueue();
      });
      expect(result.current.queue).toEqual([]);
      expect(result.current.totalCount).toBe(0);

      // Cursor reset means the same printing is no longer a dupe.
      let outcome: ReturnType<typeof result.current.addScan> | null = null;
      act(() => {
        outcome = result.current.addScan(card);
      });
      expect(outcome).toBe('accepted');
      expect(result.current.queue).toHaveLength(1);
    });
  });

  describe('changeQty', () => {
    it('adds delta to the targeted row', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard());
        result.current.addScan(makeCard({ id: 'print-2' })); // qty -> 2
      });
      act(() => {
        result.current.changeQty('oracle-1', 3);
      });
      expect(result.current.queue[0].qty).toBe(5);
      expect(result.current.totalCount).toBe(5);
    });

    it('removes the row when delta brings qty to or below zero', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard());
      });
      act(() => {
        result.current.changeQty('oracle-1', -1);
      });
      expect(result.current.queue).toEqual([]);
    });

    it('is a no-op for unknown ids', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard());
      });
      const before = result.current.queue;
      act(() => {
        result.current.changeQty('nope', 5);
      });
      expect(result.current.queue).toEqual(before);
    });
  });

  describe('changePrinting', () => {
    it('swaps the card while preserving qty and id', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard());
      });
      const newPrinting = makeCard({ id: 'print-secret-lair', name: 'Sol Ring (SLD)' });
      act(() => {
        result.current.changePrinting('oracle-1', newPrinting);
      });
      expect(result.current.queue[0].id).toBe('oracle-1');
      expect(result.current.queue[0].qty).toBe(1);
      expect(result.current.queue[0].card.id).toBe('print-secret-lair');
      expect(result.current.queue[0].card.name).toBe('Sol Ring (SLD)');
    });
  });

  describe('incrementByOracleId', () => {
    it('bumps qty of an existing entry', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard());
      });
      act(() => {
        result.current.incrementByOracleId('oracle-1');
      });
      expect(result.current.queue[0].qty).toBe(2);
    });

    it('is a no-op when the entry is not present', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.incrementByOracleId('not-in-queue');
      });
      expect(result.current.queue).toEqual([]);
    });
  });

  describe('totalPrice', () => {
    it('sums qty × usd across the queue', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(
          makeCard({ oracle_id: 'oracle-a', prices: { usd: '2.50' } as ScryfallCard['prices'] })
        );
        result.current.addScan(
          makeCard({
            id: 'print-b',
            oracle_id: 'oracle-b',
            prices: { usd: '0.50' } as ScryfallCard['prices'],
          })
        );
      });
      // Two distinct cards, qty 1 each: 2.50 + 0.50 = 3.00
      expect(result.current.totalPrice).toBeCloseTo(3.0);

      // Bump qty on the $2.50 card by 2 -> total becomes 3*2.50 + 0.50 = 8.00.
      act(() => {
        result.current.changeQty('oracle-a', 2);
      });
      expect(result.current.totalPrice).toBeCloseTo(8.0);
    });

    it('falls back to usd_foil when usd is missing', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(
          makeCard({ prices: { usd_foil: '7.00' } as ScryfallCard['prices'] })
        );
      });
      expect(result.current.totalPrice).toBeCloseTo(7.0);
    });

    it('falls back to usd_etched when usd and usd_foil are missing', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(
          makeCard({ prices: { usd_etched: '4.20' } as ScryfallCard['prices'] })
        );
      });
      expect(result.current.totalPrice).toBeCloseTo(4.2);
    });

    it('ignores entries with no usable price', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ prices: {} as ScryfallCard['prices'] }));
        result.current.addScan(
          makeCard({
            id: 'print-b',
            oracle_id: 'oracle-b',
            prices: { usd: '1.00' } as ScryfallCard['prices'],
          })
        );
      });
      expect(result.current.totalPrice).toBeCloseTo(1.0);
    });
  });

  describe('stable identities', () => {
    it('returns stable function references across renders', () => {
      const { result, rerender } = renderHook(() => useScanQueue());
      const first = {
        addScan: result.current.addScan,
        removeFromQueue: result.current.removeFromQueue,
        clearQueue: result.current.clearQueue,
        changeQty: result.current.changeQty,
        changePrinting: result.current.changePrinting,
        incrementByOracleId: result.current.incrementByOracleId,
      };
      rerender();
      expect(result.current.addScan).toBe(first.addScan);
      expect(result.current.removeFromQueue).toBe(first.removeFromQueue);
      expect(result.current.clearQueue).toBe(first.clearQueue);
      expect(result.current.changeQty).toBe(first.changeQty);
      expect(result.current.changePrinting).toBe(first.changePrinting);
      expect(result.current.incrementByOracleId).toBe(first.incrementByOracleId);
    });
  });
});
