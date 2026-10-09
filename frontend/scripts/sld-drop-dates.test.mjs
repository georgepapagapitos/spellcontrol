// Real entries from the 2026-10 snapshot (MTGJSON drops) and Scryfall
// (released_at per printing), E456.
import { describe, it, expect } from 'vitest';
import { pruneOutlierDrops, MAX_DROP_GAP_DAYS } from './sld-drop-dates.mjs';

// Ral, Storm Conduit (#523, 2019-12-16) is filed under 2021 drops; Ob Nixilis,
// the Hate-Twisted (#511, 2020-02-18) sits correctly under a 2020 drop.
const DROPS = [
  {
    name: 'Culture Shocks Grixis',
    releasedAt: '2021-08-25',
    numbers: ['523', '124', '125', '129'],
  },
  { name: 'A Box of Rocks', releasedAt: '2021-03-15', numbers: ['523', '201', '202', '203'] },
  {
    name: 'Ornithological Studies',
    releasedAt: '2020-06-09',
    numbers: ['511', '503', '504', '505'],
  },
  { name: 'Bitterblossom Dreams', releasedAt: '2019-12-03', numbers: ['523', '520', '521'] },
  {
    name: 'Showcase Read The Fine Print',
    releasedAt: '2022-01-28',
    numbers: ['159', '160', '161', '510'],
  },
  // Every member is ~420 days off: the drop's date is wrong, not its members.
  {
    name: 'Faerie Faerie Faerie Rad',
    releasedAt: '2021-04-13',
    numbers: ['115', '116', '117', '118', '512', '529', '534'],
  },
];
const PRINTINGS = [
  ['523', '2019-12-16'],
  ['511', '2020-02-18'],
  ['510', '2020-02-18'],
  ['125', '2021-04-26'],
  ['124', '2021-04-26'],
  ['129', '2021-04-26'],
  ['201', '2021-01-20'],
  ['202', '2021-01-20'],
  ['203', '2021-01-20'],
  ['503', '2020-02-18'],
  ['504', '2020-02-18'],
  ['505', '2020-02-18'],
  ['520', '2019-12-16'],
  ['521', '2019-12-16'],
  ['159', '2021-10-15'],
  ['160', '2021-10-15'],
  ['161', '2021-10-15'],
  ...['115', '116', '117', '118'].map((n) => [n, '2020-02-12']),
  ...['512', '529', '534'].map((n) => [n, '2020-02-18']),
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

  it('keeps every member of a consistently offset drop (Faerie Faerie Faerie Rad #115)', () => {
    expect(dropsFor(drops, '115')).toEqual(['Faerie Faerie Faerie Rad']);
    const faerie = drops.find((d) => d.name === 'Faerie Faerie Faerie Rad');
    expect(faerie.numbers).toHaveLength(7);
    expect(removed.some((r) => r.drop === 'Faerie Faerie Faerie Rad')).toBe(false);
  });

  it('leaves a number whose only drop is an outlier unmapped', () => {
    expect(dropsFor(drops, '510')).toEqual([]);
    expect(dropsFor(drops, '159')).toEqual(['Showcase Read The Fine Print']);
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
