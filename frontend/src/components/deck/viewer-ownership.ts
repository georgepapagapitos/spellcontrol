import type { Row } from './deck-display-rows';

/**
 * Re-derive row status from the viewer's name-level ownership, for a deck shown
 * without an allocation layer (someone else's shared deck). No slot there is
 * bound to one of the viewer's copies, so `classifyAllocation` reads every row
 * as unowned and the card preview told a viewer who owns the card "Not in your
 * collection". An owned row reads as covered; the rest keep their status.
 */
export function withViewerOwnership(rows: Row[], owned: (name: string) => boolean): Row[] {
  return rows.map((r) =>
    owned(r.name)
      ? {
          ...r,
          status: 'allocated',
          allocatedQty: r.qty,
          unownedQty: 0,
          orphanQty: 0,
          claimedElsewhereQty: 0,
          claimedBy: undefined,
        }
      : r
  );
}
