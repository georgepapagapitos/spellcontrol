/**
 * Frank Karsten, "How Many Sources Do You Need to Consistently Cast Your
 * Spells? A 2022 Update" (TCGplayer, 2022-08-02), 99-card column: the minimum
 * colored sources to cast a spell on curve "consistently" (at (89 + mana
 * value)% probability), with his probability there and at 15 sources. The
 * Commander assumptions (41 lands, free mulligan and turn-1 draw) are quoted
 * in `mana-sim/karsten.test.ts`, which reproduces every cell with the
 * simulator. One copy of the numbers: that test and the generator's colored
 * source targets (`manabaseMath.ts`) both read it.
 */

export interface KarstenCell {
  cost: string;
  /** Karsten's own example card for the shape (real Oracle data). */
  name: string;
  basic: string;
  /** Published minimum sources and his probability there, then his probability at 15. */
  minimum: [sources: number, percent: number];
  at15: number;
}

export const KARSTEN_99_TABLE: KarstenCell[] = [
  { cost: 'C', name: 'Monastery Swiftspear', basic: 'Mountain', minimum: [19, 90.0], at15: 82.1 },
  { cost: '1C', name: 'Ledger Shredder', basic: 'Island', minimum: [19, 92.1], at15: 85.1 },
  { cost: '2C', name: 'Reckless Stormseeker', basic: 'Mountain', minimum: [18, 93.1], at15: 88.2 },
  { cost: '3C', name: 'Collected Company', basic: 'Forest', minimum: [16, 93.1], at15: 91.5 },
  { cost: '4C', name: 'Doubling Season', basic: 'Forest', minimum: [15, 94.3], at15: 94.3 },
  { cost: '5C', name: 'Drowner of Hope', basic: 'Island', minimum: [14, 95.3], at15: 96.4 },
  { cost: 'CC', name: 'Lord of Atlantis', basic: 'Island', minimum: [30, 92.3], at15: 49.2 },
  {
    cost: '1CC',
    name: 'Narset, Parter of Veils',
    basic: 'Island',
    minimum: [28, 93.0],
    at15: 55.8,
  },
  { cost: '2CC', name: 'Wrath of God', basic: 'Plains', minimum: [26, 94.3], at15: 63.7 },
  { cost: '3CC', name: 'Baneslayer Angel', basic: 'Plains', minimum: [23, 94.0], at15: 72.0 },
  { cost: '4CC', name: 'Primeval Titan', basic: 'Forest', minimum: [22, 96.0], at15: 79.3 },
  { cost: '5CC', name: 'Hullbreaker Horror', basic: 'Island', minimum: [20, 96.2], at15: 85.6 },
  { cost: 'CCC', name: 'Goblin Chainwhirler', basic: 'Mountain', minimum: [36, 93.0], at15: 22.4 },
  { cost: '1CCC', name: 'Cryptic Command', basic: 'Island', minimum: [33, 94.0], at15: 29.2 },
  { cost: '2CCC', name: 'Garruk, Primal Hunter', basic: 'Forest', minimum: [30, 94.6], at15: 38.3 },
  { cost: '3CCC', name: 'Massacre Wurm', basic: 'Swamp', minimum: [28, 96.0], at15: 48.2 },
  { cost: '4CCC', name: 'Nyxbloom Ancient', basic: 'Forest', minimum: [26, 96.7], at15: 58.6 },
  { cost: 'CCCC', name: 'Dawn Elemental', basic: 'Plains', minimum: [39, 94.7], at15: 8.5 },
  { cost: '1CCCC', name: 'Unnatural Growth', basic: 'Forest', minimum: [36, 95.6], at15: 13.1 },
];

/**
 * Minimum sources for a cost of `generic` other mana plus `pips` pips of one
 * color. Shapes past the table's edge take its nearest cell: generic mana
 * saturates at the largest the table lists for that pip count, and more than
 * four pips reads as four.
 */
const MAX_GENERIC: Record<number, number> = { 1: 5, 2: 5, 3: 4, 4: 1 };
const MINIMUM = new Map(
  KARSTEN_99_TABLE.map((cell) => {
    const generic = Number(cell.cost.match(/^\d*/)![0] || 0);
    const pips = cell.cost.replace(/^\d*/, '').length;
    return [`${generic}:${pips}`, cell.minimum[0]] as const;
  })
);

export function karstenMinimumSources(generic: number, pips: number): number {
  const p = Math.min(4, Math.max(1, Math.round(pips)));
  const g = Math.min(MAX_GENERIC[p], Math.max(0, Math.round(generic)));
  return MINIMUM.get(`${g}:${p}`)!;
}
