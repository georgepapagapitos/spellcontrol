import { describe, it, expect } from 'vitest';
import {
  packInOrder,
  packSections,
  listColumnCount,
  sectionRowCount,
  LIST_TARGET_ROWS_PER_COL,
} from './deck-display-rows';

const sec = (title: string, n: number) => ({ title, rows: Array.from({ length: n }, (_, i) => i) });
const names = (cols: Array<Array<{ title: string }>>) => cols.map((c) => c.map((s) => s.title));

describe('packSections', () => {
  // The real shape that motivated this: a Dimir deck at four columns.
  const deck = [
    sec('Creature', 31),
    sec('Artifact', 10),
    sec('Enchantment', 3),
    sec('Instant', 11),
    sec('Sorcery', 9),
    sec('Land', 35),
  ];

  it('gives each giant its own column and shares the small sections, in type order', () => {
    // Was [Creature] [Artifact, Sorcery] [Enchantment, Instant] [Land]: balanced
    // by reordering, so reading down the columns put Sorcery before Enchantment
    // and Instant, while the card carousel stepped Enchantment → Instant →
    // Sorcery. Same balance now, and the columns read in type order.
    expect(names(packSections(deck, 4))).toEqual([
      ['Creature'],
      ['Artifact', 'Enchantment'],
      ['Instant', 'Sorcery'],
      ['Land'],
    ]);
  });

  it('reads, column by column, in exactly the type order (the carousel order)', () => {
    for (const cols of [1, 2, 3, 4, 5, 6]) {
      expect(packSections(deck, cols).flat()).toEqual(deck);
    }
  });

  it('balances heights instead of flowing in document order', () => {
    const heights = packSections(deck, 4).map((c) => c.reduce((h, s) => h + s.rows.length, 0));
    // Document-order flow left a column holding only Enchantment (3 rows).
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(13);
    expect(Math.max(...heights)).toBeLessThanOrEqual(35);
  });

  it('one column is the plain type order', () => {
    expect(names(packSections(deck, 1))).toEqual([deck.map((s) => s.title)]);
  });

  it('never emits an empty column and handles no sections', () => {
    expect(packSections([], 4)).toEqual([]);
    expect(names(packSections([sec('Creature', 5)], 4))).toEqual([['Creature']]);
  });
});

describe('packInOrder', () => {
  // Every contiguous split of `hs` into exactly k non-empty runs.
  function* splits(hs: number[], k: number, from = 0): Generator<number[][]> {
    if (k === 1) {
      yield [hs.slice(from)];
      return;
    }
    for (let end = from + 1; end <= hs.length - (k - 1); end++) {
      for (const rest of splits(hs, k - 1, end)) yield [hs.slice(from, end), ...rest];
    }
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  // A seeded generator, so a failure reproduces.
  let seed = 7;
  const rand = (max: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 1 + (seed % max);
  };

  it('keeps the input order and the shortest possible tallest column, on 300 random decks', () => {
    for (let t = 0; t < 300; t++) {
      const hs = Array.from({ length: rand(9) }, () => rand(36));
      const cols = rand(6);
      const packed = packInOrder(hs, cols, (h) => h);
      expect(packed.flat()).toEqual(hs);
      expect(packed.every((c) => c.length > 0)).toBe(true);
      expect(packed).toHaveLength(Math.min(cols, hs.length));
      const best = Math.min(...[...splits(hs, packed.length)].map((s) => Math.max(...s.map(sum))));
      expect(Math.max(...packed.map(sum))).toBe(best);
    }
  });
});

describe('listColumnCount', () => {
  // The screenshot that motivated this (2026-09-19): a 100-card Commander
  // deck on a ~1700px list got six 280px columns — one section each, most of
  // them empty below the fold — and every card name ellipsised to ~90px.
  const commanderDeck = [
    { rows: Array(26) },
    { rows: Array(6) },
    { rows: Array(5) },
    { rows: Array(9) },
    { rows: Array(17) },
    { rows: Array(36) },
  ];

  it('caps the column count by row count, not just by width', () => {
    const rows = sectionRowCount(commanderDeck);
    expect(listColumnCount(1700, rows)).toBe(4);
    // Even wider: still four — the extra width goes to the names.
    expect(listColumnCount(2600, rows)).toBe(4);
  });

  it('still lets the width bound it on a narrower list', () => {
    const rows = sectionRowCount(commanderDeck);
    expect(listColumnCount(700, rows)).toBe(2);
    expect(listColumnCount(1000, rows)).toBe(3);
  });

  it('a small deck stays in one column however wide the screen is', () => {
    expect(listColumnCount(2000, LIST_TARGET_ROWS_PER_COL)).toBe(1);
    expect(listColumnCount(2000, LIST_TARGET_ROWS_PER_COL + 1)).toBe(2);
  });

  it('an unmeasured list (width 0) is one column', () => {
    expect(listColumnCount(0, 500)).toBe(1);
  });

  it('a 400-card cube still fans out to fill the width', () => {
    expect(listColumnCount(1700, 420)).toBe(5);
  });

  // The card inspector (2026-09-20) takes a 300px column plus a 24px gap off
  // the list's measured width at its 1440px gate. The list measures itself, so
  // nothing here changes — this pins the consequence so a future widening of
  // the inspector can't silently drop a Commander deck to two columns.
  it('gives a Commander deck three columns beside the card inspector', () => {
    const rows = sectionRowCount(commanderDeck);
    const besideInspector = (viewport: number) => viewport - 300 - 24 - 64; // panel, gap, gutters
    expect(listColumnCount(besideInspector(1440), rows)).toBe(3);
    // A wider display gets the fourth column back.
    expect(listColumnCount(besideInspector(1800), rows)).toBe(4);
  });
});
