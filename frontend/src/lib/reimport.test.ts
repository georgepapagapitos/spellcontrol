import { describe, it, expect } from 'vitest';
import { findPriorImports } from './reimport';
import type { ImportHistoryEntry } from './local-cards';

function entry(over: Partial<ImportHistoryEntry> & { name: string }): ImportHistoryEntry {
  return { count: 100, format: 'manabox', addedAt: 1, ...over };
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
