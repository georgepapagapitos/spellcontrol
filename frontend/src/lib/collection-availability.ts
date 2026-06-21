import type { Deck } from '../store/decks';
import type { SavedCube } from '../store/cube';
import type { EnrichedCard } from '../types';
import { buildAllocationMap, isBasicLandName } from './allocations';

export interface AvailableCollection {
  names: Set<string>;
  counts: Map<string, number>;
}

/** A basic-land printing the user owns free copies of, with how many. */
export interface BasicPrintingAvail {
  scryfallId: string;
  set: string;
  collectorNumber: string;
  setName: string;
  count: number;
}

/**
 * Per-printing breakdown of the free (unallocated) basic lands the user owns,
 * keyed by card name and sorted by owned count descending. Lets deck generation
 * pull real groups of a player's basics (e.g. 12 of one Forest printing + 8 of
 * another) instead of stamping N copies of a single default printing.
 */
export function buildBasicPrintingAvailability(
  collection: EnrichedCard[],
  decks: Deck[],
  physicalCubes?: SavedCube[]
): Map<string, BasicPrintingAvail[]> {
  const claimed = buildAllocationMap(decks, physicalCubes);
  const byName = new Map<string, Map<string, BasicPrintingAvail>>();
  for (const c of collection) {
    if (!isBasicLandName(c.name) || claimed.has(c.copyId)) continue;
    let byPrinting = byName.get(c.name);
    if (!byPrinting) {
      byPrinting = new Map();
      byName.set(c.name, byPrinting);
    }
    const existing = byPrinting.get(c.scryfallId);
    if (existing) existing.count += 1;
    else
      byPrinting.set(c.scryfallId, {
        scryfallId: c.scryfallId,
        set: c.setCode,
        collectorNumber: c.collectorNumber,
        setName: c.setName,
        count: 1,
      });
  }
  const result = new Map<string, BasicPrintingAvail[]>();
  for (const [name, m] of byName) {
    result.set(
      name,
      [...m.values()].sort((a, b) => b.count - a.count || a.scryfallId.localeCompare(b.scryfallId))
    );
  }
  return result;
}

/**
 * Plan which printing each of `count` basic-land copies should use, drawing
 * from owned printings largest-group-first. Returns one entry per copy; `null`
 * means "no owned copy left — use the default printing" (the user must acquire
 * it). Pure so the allocation is unit-testable without the network.
 */
export function planBasicPrintings(
  count: number,
  printings: BasicPrintingAvail[]
): (BasicPrintingAvail | null)[] {
  const plan: (BasicPrintingAvail | null)[] = [];
  for (const p of printings) {
    const take = Math.min(p.count, count - plan.length);
    for (let j = 0; j < take; j++) plan.push(p);
    if (plan.length >= count) break;
  }
  while (plan.length < count) plan.push(null);
  return plan;
}

export function buildAvailableCollection(
  collection: EnrichedCard[],
  decks: Deck[],
  physicalCubes?: SavedCube[]
): AvailableCollection {
  const claimed = buildAllocationMap(decks, physicalCubes);
  const names = new Set<string>();
  const counts = new Map<string, number>();

  for (const card of collection) {
    if (claimed.has(card.copyId)) continue;
    names.add(card.name);
    counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  }

  return { names, counts };
}
