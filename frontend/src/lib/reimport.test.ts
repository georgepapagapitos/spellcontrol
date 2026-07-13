import { describe, it, expect } from 'vitest';
import { findPriorImports, findContentReimportMatch } from './reimport';
import type { ImportHistoryEntry } from './local-cards';

function entry(over: Partial<ImportHistoryEntry> & { name: string }): ImportHistoryEntry {
  return { id: 'imp', count: 100, format: 'manabox', addedAt: 1, ...over };
}

interface TestCard {
  scryfallId: string;
  name: string;
  setCode: string;
  finish: 'nonfoil';
  importId?: string;
}

/** N distinct printings (unique scryfallId per index), one copy each, all stamped with `importId`. */
function distinctCards(n: number, importId: string | undefined, keyOffset = 0): TestCard[] {
  return Array.from({ length: n }, (_, i) => ({
    scryfallId: `sf-${i + keyOffset}`,
    name: `Card ${i + keyOffset}`,
    setCode: 'set',
    finish: 'nonfoil',
    importId,
  }));
}

describe('findPriorImports', () => {
  it('returns [] when there is no history', () => {
    expect(findPriorImports(['manabox.csv'], [])).toEqual([]);
  });

  it('returns [] when nothing matches', () => {
    const history = [entry({ name: 'archidekt.csv' })];
    expect(findPriorImports(['manabox.csv'], history)).toEqual([]);
  });

  it('flags a filename that was imported before', () => {
    const prior = entry({ name: 'manabox.csv', count: 1234, addedAt: 10 });
    const result = findPriorImports(['manabox.csv'], [entry({ name: 'other.csv' }), prior]);
    expect(result).toEqual([prior]);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const prior = entry({ name: 'ManaBox.csv', addedAt: 5 });
    expect(findPriorImports(['  manabox.csv '], [prior])).toEqual([prior]);
  });

  it('never treats synthetic paste/scan labels as a re-import', () => {
    const history = [entry({ name: 'pasted-list' }), entry({ name: 'scanned-cards' })];
    expect(findPriorImports(['pasted-list'], history)).toEqual([]);
    expect(findPriorImports(['scanned-cards'], history)).toEqual([]);
  });

  it('returns the MOST RECENT entry when a name was imported repeatedly', () => {
    const old = entry({ name: 'col.csv', addedAt: 1, count: 10 });
    const recent = entry({ name: 'col.csv', addedAt: 99, count: 20 });
    const result = findPriorImports(['col.csv'], [old, recent]);
    expect(result).toEqual([recent]);
    expect(result).toHaveLength(1);
  });

  it('handles a staged batch: matched files only, most-recent-first', () => {
    const a = entry({ name: 'a.csv', addedAt: 30 });
    const b = entry({ name: 'b.csv', addedAt: 50 });
    const history = [a, b, entry({ name: 'unrelated.csv', addedAt: 40 })];
    const result = findPriorImports(['a.csv', 'b.csv', 'c-new.csv'], history);
    expect(result).toEqual([b, a]);
  });

  it('returns [] for empty incoming names', () => {
    expect(findPriorImports([], [entry({ name: 'x.csv' })])).toEqual([]);
  });
});

describe('findContentReimportMatch', () => {
  it('trips on an exact re-import even under a renamed file', () => {
    const prior = entry({ id: 'imp1', name: 'old-export.csv', addedAt: 1 });
    const existing = distinctCards(10, 'imp1');
    // Same 10 printings, different file name — the renamed-export case
    // findPriorImports (name-only) would miss entirely.
    const incoming = distinctCards(10, undefined);

    const match = findContentReimportMatch(incoming, [prior], existing);
    expect(match).not.toBeNull();
    expect(match?.entry).toBe(prior);
    expect(match?.printingOverlap).toBe(1);
    expect(match?.quantityOverlap).toBe(1);
  });

  it('does not trip on a wholly disjoint import', () => {
    const prior = entry({ id: 'imp1', name: 'old-export.csv' });
    const existing = distinctCards(10, 'imp1');
    const incoming = distinctCards(10, undefined, 1000); // no overlapping scryfallIds

    expect(findContentReimportMatch(incoming, [prior], existing)).toBeNull();
  });

  it('does not trip on a new batch that merely shares a few staples', () => {
    const prior = entry({ id: 'imp1', name: 'old-export.csv' });
    const existing = distinctCards(10, 'imp1'); // sf-0..sf-9
    // 20-card batch: 3 staples already owned (sf-0..sf-2) + 17 brand-new cards.
    const incoming = [...distinctCards(3, undefined), ...distinctCards(17, undefined, 2000)];

    expect(findContentReimportMatch(incoming, [prior], existing)).toBeNull();
  });

  it('pins the 0.85 threshold: exactly-at trips, just-below does not', () => {
    const prior = entry({ id: 'imp1', name: 'old-export.csv' });
    const existing = distinctCards(20, 'imp1'); // sf-0..sf-19

    // 17/20 = 0.85 overlap on both printings and quantity — clears the gate.
    const atThreshold = [...distinctCards(17, undefined), ...distinctCards(3, undefined, 5000)];
    expect(findContentReimportMatch(atThreshold, [prior], existing)).not.toBeNull();

    // 16/20 = 0.80 — just under, gate stays closed.
    const belowThreshold = [...distinctCards(16, undefined), ...distinctCards(4, undefined, 5000)];
    expect(findContentReimportMatch(belowThreshold, [prior], existing)).toBeNull();
  });

  it('picks the history entry with the strongest overlap when several qualify', () => {
    const weaker = entry({ id: 'imp1', name: 'a.csv', addedAt: 1 });
    const stronger = entry({ id: 'imp2', name: 'b.csv', addedAt: 2 });
    const existing = [
      // imp1: only 17 of its 20 cards match the incoming batch (0.85 — barely qualifies).
      ...distinctCards(17, 'imp1'),
      ...distinctCards(3, 'imp1', 9000),
      // imp2: all 20 match (1.0 — the stronger signal).
      ...distinctCards(20, 'imp2'),
    ];
    const incoming = distinctCards(20, undefined); // sf-0..sf-19

    const match = findContentReimportMatch(incoming, [weaker, stronger], existing);
    expect(match?.entry).toBe(stronger);
  });

  it('returns null for empty incoming or empty history', () => {
    const existing = distinctCards(5, 'imp1');
    expect(
      findContentReimportMatch([], [entry({ id: 'imp1', name: 'x.csv' })], existing)
    ).toBeNull();
    expect(findContentReimportMatch(distinctCards(5, undefined), [], existing)).toBeNull();
  });

  it('ignores history entries whose cards are no longer in the collection (deleted import)', () => {
    const prior = entry({ id: 'imp1', name: 'old-export.csv' });
    const incoming = distinctCards(10, undefined);
    // No existing cards carry importId 'imp1' — e.g. that import was since deleted.
    expect(findContentReimportMatch(incoming, [prior], [])).toBeNull();
  });
});
