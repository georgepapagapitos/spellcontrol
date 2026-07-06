// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { entryKey, useScanQueue, useScanQueueStore } from './use-scan-queue';
import type { ScryfallCard } from '@/deck-builder/types';

// The queue is now a persisted module-singleton store; reset it (and its
// localStorage backing) before each test so state doesn't leak across cases.
beforeEach(() => {
  localStorage.clear();
  useScanQueueStore.setState({ queue: [] });
});

// Row identity is printing id + finish; scans land as nonfoil.
const NONFOIL_1 = entryKey('print-1', 'nonfoil');

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
        id: NONFOIL_1,
        qty: 1,
        finish: 'nonfoil',
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

    it('keeps different printings of the same card as separate rows, each with its own set/collector', () => {
      // E85 regression: keying on oracle_id collapsed printings, silently
      // discarding the second scan's real set/collector number on import.
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ id: 'print-c14', set: 'c14', collector_number: '261' }));
      });
      act(() => {
        result.current.addScan(makeCard({ id: 'print-sld', set: 'sld', collector_number: '1546' }));
      });
      expect(result.current.queue).toHaveLength(2);
      expect(result.current.queue.map((e) => [e.card.set, e.card.collector_number])).toEqual([
        ['c14', '261'],
        ['sld', '1546'],
      ]);
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
      expect(result.current.queue.map((e) => e.id)).toEqual([
        entryKey('print-1', 'nonfoil'),
        entryKey('print-2', 'nonfoil'),
      ]);
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
        result.current.removeFromQueue(NONFOIL_1);
      });
      let outcome: ReturnType<typeof result.current.addScan> | null = null;
      act(() => {
        outcome = result.current.addScan(card);
      });
      expect(outcome).toBe('accepted');
      expect(result.current.queue).toHaveLength(1);
    });

    it('force bypasses the dedupe (tap-to-rescan) but keeps the cursor parked', () => {
      const { result } = renderHook(() => useScanQueue());
      const card = makeCard();
      act(() => {
        result.current.addScan(card);
      });
      // A deliberate forced add increments the same card...
      let forced: ReturnType<typeof result.current.addScan> | null = null;
      act(() => {
        forced = result.current.addScan(card, true);
      });
      expect(forced).toBe('accepted');
      expect(result.current.queue[0].qty).toBe(2);
      // ...but the cursor stays on it, so the *auto* loop still dedupes.
      let auto: ReturnType<typeof result.current.addScan> | null = null;
      act(() => {
        auto = result.current.addScan(card);
      });
      expect(auto).toBe('duplicate');
      expect(result.current.queue[0].qty).toBe(2);
    });
  });

  describe('addManual', () => {
    it('appends a manually-searched card with qty 1', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addManual(makeCard());
      });
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0]).toMatchObject({ id: NONFOIL_1, qty: 1 });
    });

    it('increments instead of deduping when the same card is added twice in a row', () => {
      const { result } = renderHook(() => useScanQueue());
      const card = makeCard();
      act(() => {
        result.current.addManual(card);
      });
      act(() => {
        // Auto-scan would dedupe an identical back-to-back id; manual add must not.
        result.current.addManual(card);
      });
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0].qty).toBe(2);
    });

    it('clears the dedupe cursor so a subsequent identical scan is accepted', () => {
      const { result } = renderHook(() => useScanQueue());
      const card = makeCard();
      act(() => {
        result.current.addScan(card); // sets the cursor to card.id
      });
      act(() => {
        result.current.addManual(card); // should reset the cursor
      });
      let outcome: ReturnType<typeof result.current.addScan> | null = null;
      act(() => {
        outcome = result.current.addScan(card);
      });
      expect(outcome).toBe('accepted');
      expect(result.current.queue[0].qty).toBe(3);
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
        result.current.removeFromQueue(entryKey('print-1', 'nonfoil'));
      });
      expect(result.current.queue.map((e) => e.id)).toEqual([entryKey('print-b', 'nonfoil')]);

      act(() => {
        result.current.removeFromQueue('does-not-exist');
      });
      expect(result.current.queue.map((e) => e.id)).toEqual([entryKey('print-b', 'nonfoil')]);
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
        result.current.addScan(makeCard(), true); // forced rescan, qty -> 2
      });
      act(() => {
        result.current.changeQty(NONFOIL_1, 3);
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
        result.current.changeQty(NONFOIL_1, -1);
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
    it('swaps the card, preserving qty and re-keying the row to the new printing', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard());
      });
      const newPrinting = makeCard({ id: 'print-secret-lair', name: 'Sol Ring (SLD)' });
      act(() => {
        result.current.changePrinting(NONFOIL_1, newPrinting);
      });
      expect(result.current.queue[0].id).toBe(entryKey('print-secret-lair', 'nonfoil'));
      expect(result.current.queue[0].qty).toBe(1);
      expect(result.current.queue[0].card.id).toBe('print-secret-lair');
      expect(result.current.queue[0].card.name).toBe('Sol Ring (SLD)');
    });

    it('merges into an existing row when swapped to a printing already queued', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ id: 'print-c14' }));
      });
      act(() => {
        result.current.addScan(makeCard({ id: 'print-sld' }));
      });
      expect(result.current.queue).toHaveLength(2);
      act(() => {
        result.current.changePrinting(
          entryKey('print-sld', 'nonfoil'),
          makeCard({ id: 'print-c14' })
        );
      });
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0].id).toBe(entryKey('print-c14', 'nonfoil'));
      expect(result.current.queue[0].qty).toBe(2);
    });

    it('clamps the finish when the new printing lacks the current one', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ finishes: ['nonfoil', 'foil'] }));
      });
      act(() => {
        result.current.changeFinish(NONFOIL_1, 'foil');
      });
      expect(result.current.queue[0].finish).toBe('foil');
      // Swap to a nonfoil-only printing — the foil finish must fall back.
      act(() => {
        result.current.changePrinting(
          entryKey('print-1', 'foil'),
          makeCard({ id: 'print-nonfoil', finishes: ['nonfoil'] })
        );
      });
      expect(result.current.queue[0].finish).toBe('nonfoil');
    });
  });

  describe('changeFinish', () => {
    it('sets the finish for the targeted entry', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ finishes: ['nonfoil', 'etched'] }));
      });
      expect(result.current.queue[0].finish).toBe('nonfoil');
      act(() => {
        result.current.changeFinish(NONFOIL_1, 'etched');
      });
      expect(result.current.queue[0].finish).toBe('etched');
    });

    it('refuses a finish the printing does not offer (clamps to nonfoil)', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(makeCard({ finishes: ['nonfoil'] }));
      });
      act(() => {
        result.current.changeFinish(NONFOIL_1, 'foil');
      });
      expect(result.current.queue[0].finish).toBe('nonfoil');
    });

    it('keeps foil and nonfoil copies of the same card as separate rows', () => {
      const { result } = renderHook(() => useScanQueue());
      const finishes = ['nonfoil', 'foil'];
      act(() => {
        result.current.addScan(makeCard({ finishes })); // nonfoil row, qty 1
      });
      act(() => {
        result.current.changeFinish(NONFOIL_1, 'foil'); // → foil row, qty 1
      });
      act(() => {
        result.current.addManual(makeCard({ finishes })); // fresh nonfoil row, qty 1
      });
      expect(result.current.queue).toHaveLength(2);
      const byId = Object.fromEntries(result.current.queue.map((e) => [e.id, e.qty]));
      expect(byId[entryKey('print-1', 'foil')]).toBe(1);
      expect(byId[entryKey('print-1', 'nonfoil')]).toBe(1);
    });

    it('merges into an existing finish row instead of creating a duplicate', () => {
      const { result } = renderHook(() => useScanQueue());
      const finishes = ['nonfoil', 'foil'];
      act(() => {
        result.current.addScan(makeCard({ finishes })); // nonfoil, qty 1
      });
      act(() => {
        result.current.changeFinish(NONFOIL_1, 'foil'); // foil row, qty 1
      });
      act(() => {
        result.current.addManual(makeCard({ finishes })); // nonfoil row, qty 1
      });
      expect(result.current.queue).toHaveLength(2);
      // Toggle the nonfoil row to foil — merges into the existing foil row.
      act(() => {
        result.current.changeFinish(NONFOIL_1, 'foil');
      });
      expect(result.current.queue).toHaveLength(1);
      expect(result.current.queue[0].id).toBe(entryKey('print-1', 'foil'));
      expect(result.current.queue[0].qty).toBe(2);
    });

    it('drives totalPrice off the selected finish', () => {
      const { result } = renderHook(() => useScanQueue());
      act(() => {
        result.current.addScan(
          makeCard({
            finishes: ['nonfoil', 'foil'],
            prices: { usd: '1.00', usd_foil: '9.00' } as ScryfallCard['prices'],
          })
        );
      });
      expect(result.current.totalPrice).toBeCloseTo(1.0);
      act(() => {
        result.current.changeFinish(NONFOIL_1, 'foil');
      });
      expect(result.current.totalPrice).toBeCloseTo(9.0);
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
        result.current.changeQty(entryKey('print-1', 'nonfoil'), 2);
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

  describe('persistence across mounts', () => {
    it('keeps the queue when the scanner is closed and reopened (hook remount)', () => {
      // First "session": scan a card, then unmount (close the scanner).
      const first = renderHook(() => useScanQueue());
      act(() => {
        first.result.current.addScan(makeCard());
      });
      expect(first.result.current.totalCount).toBe(1);
      first.unmount();

      // Second "session": a fresh hook instance still sees the queued card.
      const second = renderHook(() => useScanQueue());
      expect(second.result.current.queue).toHaveLength(1);
      expect(second.result.current.totalCount).toBe(1);
    });

    it('re-accepts a card already in the queue after remount (dedupe cursor is per-session)', () => {
      const first = renderHook(() => useScanQueue());
      act(() => {
        first.result.current.addScan(makeCard());
      });
      first.unmount();

      // Same card scanned again in a new session increments rather than being
      // silently deduped — the back-to-back cursor does not persist.
      const second = renderHook(() => useScanQueue());
      let outcome: ReturnType<typeof second.result.current.addScan> | null = null;
      act(() => {
        outcome = second.result.current.addScan(makeCard());
      });
      expect(outcome).toBe('accepted');
      expect(second.result.current.totalCount).toBe(2);
    });
  });

  describe('stable identities', () => {
    it('returns stable function references across renders', () => {
      const { result, rerender } = renderHook(() => useScanQueue());
      const first = {
        addScan: result.current.addScan,
        addManual: result.current.addManual,
        removeFromQueue: result.current.removeFromQueue,
        clearQueue: result.current.clearQueue,
        changeQty: result.current.changeQty,
        changePrinting: result.current.changePrinting,
        changeFinish: result.current.changeFinish,
      };
      rerender();
      expect(result.current.addScan).toBe(first.addScan);
      expect(result.current.addManual).toBe(first.addManual);
      expect(result.current.removeFromQueue).toBe(first.removeFromQueue);
      expect(result.current.clearQueue).toBe(first.clearQueue);
      expect(result.current.changeQty).toBe(first.changeQty);
      expect(result.current.changePrinting).toBe(first.changePrinting);
      expect(result.current.changeFinish).toBe(first.changeFinish);
    });
  });
});
