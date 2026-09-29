/**
 * Guard for E276: materializing the collection is the single most expensive
 * synchronous thing a signed-in page does (~11.5k cards sorted per binder), and
 * several surfaces ask for the same answer in one render or on a re-mount. The
 * shim must hand back the SAME result for the same inputs and only recompute
 * when a reference or an option value actually changes.
 */
import { describe, expect, it } from 'vitest';
import { __testing, materializeBinders } from './materialize';
import type { BinderDef, EnrichedCard } from '@/types/index';

const card = (name: string, copyId: string): EnrichedCard =>
  ({
    copyId,
    name,
    scryfallId: `${copyId}-sf`,
    setCode: 'lea',
    setName: 'Alpha',
    typeLine: 'Creature — Elf',
    colorIdentity: ['G'],
    cmc: 1,
    quantity: 1,
  }) as unknown as EnrichedCard;

const def: BinderDef = {
  id: 'b1',
  name: 'Elves',
  position: 0,
  filterGroups: [{ filter: {} }],
  sorts: [],
  pocketSize: 9,
  doubleSided: false,
  fixedCapacity: null,
  color: '#888',
  createdAt: 1,
  updatedAt: 1,
};

describe('materializeBinders memo', () => {
  it('returns the identical result for the same references and option values', () => {
    const cards = [card('Llanowar Elves', 'c1'), card('Elvish Mystic', 'c2')];
    const defs = [def];
    const first = materializeBinders(cards, defs, { search: '' });
    const second = materializeBinders(cards, defs, { search: '' });
    expect(second).toBe(first);
    expect(first.binders[0].totalCards).toBe(2);
  });

  it('recomputes when a reference or an option value changes', () => {
    const cards = [card('Llanowar Elves', 'c1')];
    const defs = [def];
    const base = materializeBinders(cards, defs, { search: '' });
    expect(materializeBinders([...cards], defs, { search: '' })).not.toBe(base);
    expect(materializeBinders(cards, [...defs], { search: '' })).not.toBe(base);
    expect(materializeBinders(cards, defs, { search: 'llan' })).not.toBe(base);
    expect(materializeBinders(cards, defs, { search: '', allocatedCopyIds: new Set() })).not.toBe(
      base
    );
    // Bounded: the window never grows past its limit.
    expect(__testing.recent.length).toBeLessThanOrEqual(4);
  });
});
