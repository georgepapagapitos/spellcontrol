// Real entries from the 2026-10 snapshot (MTGJSON drops) and Scryfall
// (released_at per printing), E456.
import { describe, it, expect } from 'vitest';
import { pruneOutlierDrops, MAX_DROP_GAP_DAYS } from './sld-drop-dates.mjs';

// Ral, Storm Conduit (#523, 2019-12-16) is filed under 2021 drops; Ob Nixilis,
// the Hate-Twisted (#511, 2020-02-18) sits correctly under a 2020 drop.
const DROPS = [
  { name: 'Culture Shocks Grixis', releasedAt: '2021-08-25', numbers: ['523', '125'] },
  { name: 'A Box of Rocks', releasedAt: '2021-03-15', numbers: ['523', '201'] },
  { name: 'Ornithological Studies', releasedAt: '2020-06-09', numbers: ['511'] },
  { name: 'Bitterblossom Dreams', releasedAt: '2019-12-03', numbers: ['523'] },
  { name: 'Showcase Read The Fine Print', releasedAt: '2022-01-28', numbers: ['510'] },
];
const PRINTINGS = [
  ['523', '2019-12-16'],
  ['511', '2020-02-18'],
  ['510', '2020-02-18'],
  ['125', '2021-04-26'],
];

const dropsFor = (drops, n) => drops.filter((d) => d.numbers.includes(n)).map((d) => d.name);

describe('pruneOutlierDrops', () => {
  const { drops, removed } = pruneOutlierDrops(DROPS, PRINTINGS);

  it('uses the cutoff measured from the real gap distribution', () => {
    expect(MAX_DROP_GAP_DAYS).toBe(170);
  });

  it('gives Ral, Storm Conduit no 2021 drop', () => {
    expect(dropsFor(drops, '523')).toEqual(['Bitterblossom Dreams']);
    expect(removed.filter((r) => r.number === '523').map((r) => r.drop)).toEqual([
      'Culture Shocks Grixis',
      'A Box of Rocks',
    ]);
  });

  it('leaves a number with only an outlier drop unmapped, and drops the empty drop', () => {
    expect(dropsFor(drops, '510')).toEqual([]);
    expect(drops.map((d) => d.name)).not.toContain('Showcase Read The Fine Print');
  });

  it('keeps a correctly dated neighbor, and a normal wave offset', () => {
    expect(dropsFor(drops, '511')).toEqual(['Ornithological Studies']); // 112 days
    expect(dropsFor(drops, '125')).toEqual(['Culture Shocks Grixis']); // 121 days
  });

  it('keeps numbers with no known printing date and drops with no date', () => {
    const r = pruneOutlierDrops(
      [{ name: 'X', releasedAt: '', numbers: ['511', '9999'] }],
      PRINTINGS
    );
    expect(r.drops[0].numbers).toEqual(['511', '9999']);
  });
});
