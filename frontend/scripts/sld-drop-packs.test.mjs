// Shaped like MTGJSON's SLD.json `booster` table (code → sheets → uuid weights)
// and the sealed-content products, with real drop dates and Scryfall printing
// dates for the 2019-12 planeswalker bonus cards (E613).
import { describe, it, expect } from 'vitest';
import { assignPackNumbers, packNumbers } from './sld-drop-packs.mjs';

const U = { c521: 'uuid-521', c524: 'uuid-524', c7152: 'uuid-7152', c9000: 'uuid-9000' };
const numberByUuid = new Map([
  [U.c521, '521'],
  [U.c524, '524'],
  [U.c7152, '7152'],
  [U.c9000, '9000'],
]);
const sheet = (...uuids) => ({
  boosters: [{ contents: { bonus: 1 }, weight: 1 }],
  sheets: { bonus: { cards: Object.fromEntries(uuids.map((u) => [u, 1])), foil: true } },
});
const booster = {
  'bonus-bitterblossom-dreams': sheet(U.c521, U.c524),
  'bonus-explosion-sounds': sheet(U.c521),
  'bonus-kaleidoscope-killers': sheet(U.c521, U.c524),
  'bonus-the-path-not-traveled': sheet(U.c521),
  'bonus-cats-of-chaos': sheet(U.c7152),
  'bonus-mystery': sheet(U.c9000),
};
const dateByDrop = new Map([
  ['Bitterblossom Dreams', '2019-12-03'],
  ['“explosion sounds”', '2019-12-07'],
  ['Kaleidoscope Killers', '2019-12-08'],
  ['The Path Not Traveled', '2020-06-03'],
  ['Cats of Chaos', '2026-06-15'],
  ['Mystery Drop', '2026-01-01'],
]);
const packCodesByDrop = new Map([
  ['Bitterblossom Dreams', new Set(['bonus-bitterblossom-dreams'])],
  ['“explosion sounds”', new Set(['bonus-explosion-sounds'])],
  ['Kaleidoscope Killers', new Set(['bonus-kaleidoscope-killers'])],
  ['The Path Not Traveled', new Set(['bonus-the-path-not-traveled'])],
  ['Cats of Chaos', new Set(['bonus-cats-of-chaos'])],
  ['Mystery Drop', new Set(['bonus-mystery'])],
]);
const printings = [
  ['521', '2019-12-16'],
  ['524', '2019-12-16'],
  ['7152', '2026-06-15'],
];
const run = (over = {}) =>
  assignPackNumbers({
    packCodesByDrop,
    numbersByPack: packNumbers(booster, numberByUuid),
    dateByDrop,
    printings,
    explicit: new Set(),
    ...over,
  });

describe('packNumbers', () => {
  it('resolves each pack code to the collector numbers on its sheets', () => {
    const packs = packNumbers(booster, numberByUuid);
    expect([...packs.get('bonus-bitterblossom-dreams')].sort()).toEqual(['521', '524']);
    expect([...packs.get('bonus-cats-of-chaos')]).toEqual(['7152']);
  });

  it('skips a uuid the set does not list', () => {
    const packs = packNumbers({ x: sheet('uuid-missing') }, numberByUuid);
    expect([...packs.get('x')]).toEqual([]);
  });
});

describe('assignPackNumbers', () => {
  it('gives a card shared by several drops to the one dated closest to its printing', () => {
    const { assigned } = run();
    const dropsOf = (n) => [...assigned].filter(([, set]) => set.has(n)).map(([d]) => d);
    // #521 sits in four packs; the printing is 2019-12-16, Kaleidoscope Killers is 8 days away.
    expect(dropsOf('521')).toEqual(['Kaleidoscope Killers']);
    expect(dropsOf('524')).toEqual(['Kaleidoscope Killers']);
  });

  it('gives a new pack-only card the drop that names its pack', () => {
    expect([...run().assigned.get('Cats of Chaos')]).toEqual(['7152']);
  });

  it('leaves a card with no printing date unmapped and says why', () => {
    const { assigned, unmapped } = run();
    expect(assigned.has('Mystery Drop')).toBe(false);
    expect(unmapped).toEqual([{ number: '9000', reason: 'no printing date' }]);
  });

  it('leaves a card unmapped when none of its drops has a date', () => {
    const { assigned, unmapped } = run({ dateByDrop: new Map() });
    expect(assigned.size).toBe(0);
    expect(unmapped.map((u) => u.reason)).toContain('no dated candidate drop');
  });

  it('breaks a tie toward the earliest drop, then the name', () => {
    const tied = new Map([
      ['Late', '2019-12-20'],
      ['Early', '2019-12-12'],
      ['Early B', '2019-12-12'],
    ]);
    const codes = new Map([
      ['Late', new Set(['bonus-explosion-sounds'])],
      ['Early B', new Set(['bonus-explosion-sounds'])],
      ['Early', new Set(['bonus-explosion-sounds'])],
    ]);
    const { assigned } = run({ dateByDrop: tied, packCodesByDrop: codes });
    // 2019-12-16 is four days from both 12-12 and 12-20: the earlier date wins, then name.
    expect([...assigned.keys()]).toEqual(['Early']);
  });

  it('does not re-credit a card some drop lists by number', () => {
    const { assigned } = run({ explicit: new Set(['521']) });
    expect([...assigned.values()].some((s) => s.has('521'))).toBe(false);
    expect([...assigned.get('Kaleidoscope Killers')]).toEqual(['524']);
  });

  it('uses the nearest of a number’s several printings', () => {
    const { assigned } = run({ printings: [...printings, ['521★', '2020-06-03']] });
    expect([...assigned.get('The Path Not Traveled')]).toContain('521');
  });
});
