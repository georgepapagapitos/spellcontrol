import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';
import type { SetMap } from './api';
import {
  completionPct,
  computeSetProgress,
  compareCollectorNumbers,
  computeSldDropProgress,
  overlaySetOwnership,
  searchCollectionCardSets,
  sortSetRows,
  type SetProgress,
} from './set-completion';
import { SLD_UNASSIGNED, parseSldDrops } from './sld-drops';

function owned(setCode: string, collectorNumber: string, extra?: Partial<EnrichedCard>) {
  return {
    copyId: `${setCode}-${collectorNumber}-${Math.random()}`,
    name: `Card ${collectorNumber}`,
    setCode,
    setName: setCode,
    collectorNumber,
    rarity: 'common',
    scryfallId: `sf-${setCode}-${collectorNumber}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manual',
    finish: 'nonfoil',
    foil: false,
    ...extra,
  } as EnrichedCard;
}

function setCard(collectorNumber: string, name = `Card ${collectorNumber}`) {
  return { id: `id-${collectorNumber}`, name, collector_number: collectorNumber } as ScryfallCard;
}

const SET_MAP: SetMap = {
  ONE: {
    code: 'ONE',
    name: 'Phyrexia',
    iconSvgUri: 'one.svg',
    releasedAt: '2023-02-03',
    cardCount: 3,
  },
  LEA: {
    code: 'LEA',
    name: 'Alpha',
    iconSvgUri: 'lea.svg',
    releasedAt: '1993-08-05',
    cardCount: 295,
  },
};

describe('completionPct', () => {
  it('never rounds a partial set up to 100', () => {
    expect(completionPct(294, 295)).toBe(99);
    expect(completionPct(295, 295)).toBe(100);
  });

  it('is 0 when the total is unknown', () => {
    expect(completionPct(10, 0)).toBe(0);
  });
});

describe('computeSetProgress', () => {
  it('counts distinct collector numbers per set, newest release first', () => {
    const rows = computeSetProgress(
      [
        owned('ONE', '1'),
        owned('ONE', '1'), // duplicate copy — still one slot
        owned('ONE', '2', { finish: 'foil', foil: true }), // finish-agnostic
        owned('LEA', '161'),
      ],
      SET_MAP
    );
    expect(rows.map((r) => r.code)).toEqual(['ONE', 'LEA']);
    expect(rows[0]).toMatchObject({ owned: 2, total: 3, pct: 67, name: 'Phyrexia' });
    expect(rows[1]).toMatchObject({ owned: 1, total: 295 });
  });

  it('keeps sets that are missing from the set map, without a total', () => {
    const rows = computeSetProgress([owned('ZZZ', '5')], SET_MAP);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'ZZZ', name: 'ZZZ', owned: 1, total: 0, pct: 0 });
  });

  it('skips rows with no set code and clamps owned to the total', () => {
    const rows = computeSetProgress(
      [
        owned('', '9'),
        owned('ONE', '1'),
        owned('ONE', '2'),
        owned('ONE', '3'),
        owned('ONE', '999'), // stray promo number beyond the checklist
      ],
      SET_MAP
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owned: 3, total: 3, pct: 100 });
  });

  it('counts numberless rows as distinct via scryfallId', () => {
    const rows = computeSetProgress(
      [owned('ONE', '', { scryfallId: 'a' }), owned('ONE', '', { scryfallId: 'b' })],
      SET_MAP
    );
    expect(rows[0].owned).toBe(2);
  });
});

describe('compareCollectorNumbers', () => {
  it('sorts numerically, with suffixed variants after the base', () => {
    expect(['10', '2', '10a', '1'].sort(compareCollectorNumbers)).toEqual(['1', '2', '10', '10a']);
  });
});

describe('overlaySetOwnership', () => {
  it('marks owned quantities per collector number and sorts by number', () => {
    const rows = overlaySetOwnership(
      [setCard('10'), setCard('2'), setCard('3')],
      [owned('ONE', '2'), owned('ONE', '2', { finish: 'foil', foil: true }), owned('OTH', '3')],
      'one'
    );
    expect(rows.map((r) => r.card.collector_number)).toEqual(['2', '3', '10']);
    expect(rows.map((r) => r.qty)).toEqual([2, 0, 0]);
  });
});

// ── Secret Lair drop expansion + hub sorting (E140) ─────────────────────────

const SLD_INDEX = parseSldDrops({
  drops: [
    { name: 'OMG KITTIES', releasedAt: '2019-12-02', numbers: ['92', '93', '94'] },
    { name: 'Box of Rocks', releasedAt: '2021-03-15', numbers: ['507', '511'] },
    // A number sold in two drops (Dan Frazier-style collision).
    { name: 'Allied Talismans', releasedAt: '2023-05-01', numbers: ['708'] },
    { name: 'Enemy Talismans', releasedAt: '2023-05-01', numbers: ['708'] },
  ],
})!;

function progressRow(over: Partial<SetProgress>): SetProgress {
  return {
    code: 'ONE',
    name: 'Phyrexia',
    iconSvgUri: 'one.svg',
    releasedAt: '2023-02-03',
    owned: 1,
    total: 3,
    pct: 33,
    ...over,
  };
}

describe('computeSldDropProgress', () => {
  it('returns one completion row per drop the collection touches', () => {
    const cards = [owned('SLD', '92'), owned('SLD', '93'), owned('SLD', '507'), owned('ONE', '2')];
    const rows = computeSldDropProgress(cards, SLD_INDEX, 'sld.svg');
    const kitties = rows.find((r) => r.drop === 'OMG KITTIES');
    expect(kitties).toMatchObject({
      code: 'SLD',
      owned: 2,
      total: 3,
      pct: 67,
      iconSvgUri: 'sld.svg',
      releasedAt: '2019-12-02',
    });
    const rocks = rows.find((r) => r.drop === 'Box of Rocks');
    expect(rocks).toMatchObject({ owned: 1, total: 2, pct: 50 });
    // Drops with nothing owned don't appear; non-SLD cards are ignored.
    expect(rows.some((r) => r.drop === 'Allied Talismans')).toBe(false);
    expect(rows).toHaveLength(2);
  });

  it('returns [] when the collection has no SLD cards', () => {
    expect(computeSldDropProgress([owned('ONE', '2')], SLD_INDEX)).toEqual([]);
  });

  it('counts a multi-drop number toward every drop it was sold in', () => {
    const rows = computeSldDropProgress([owned('SLD', '708')], SLD_INDEX);
    expect(rows.find((r) => r.drop === 'Allied Talismans')).toMatchObject({ owned: 1, total: 1 });
    expect(rows.find((r) => r.drop === 'Enemy Talismans')).toMatchObject({ owned: 1, total: 1 });
  });

  it('matches suffixed foil variants through their base number', () => {
    const rows = computeSldDropProgress([owned('SLD', '92★')], SLD_INDEX);
    expect(rows.find((r) => r.drop === 'OMG KITTIES')).toMatchObject({ owned: 1 });
  });

  it('counts a base printing and its suffixed variant as ONE owned slot', () => {
    // Owning both #92 and rainbow-foil #92★ is one checklist slot filled, not
    // two — otherwise progress inflates ("2/3" for one card plus its variant).
    const rows = computeSldDropProgress([owned('SLD', '92'), owned('SLD', '92★')], SLD_INDEX);
    expect(rows.find((r) => r.drop === 'OMG KITTIES')).toMatchObject({ owned: 1, total: 3 });
  });

  it('collects unmapped numbers into one unassigned row with unknown total', () => {
    const rows = computeSldDropProgress(
      [owned('SLD', '9999'), owned('SLD', '92')],
      SLD_INDEX,
      'sld.svg'
    );
    const rest = rows.find((r) => r.drop === SLD_UNASSIGNED);
    expect(rest).toMatchObject({ owned: 1, total: 0, pct: 0, iconSvgUri: 'sld.svg' });
    // Unassigned trails the mapped drops.
    expect(rows[rows.length - 1].drop).toBe(SLD_UNASSIGNED);
  });
});

describe('sortSetRows', () => {
  const a = progressRow({
    code: 'A',
    name: 'Alpha',
    releasedAt: '1993-08-05',
    owned: 5,
    total: 10,
    pct: 50,
  });
  const b = progressRow({
    code: 'B',
    name: 'Beta',
    releasedAt: '2023-02-03',
    owned: 9,
    total: 9,
    pct: 100,
  });
  const c = progressRow({
    code: 'C',
    name: 'Ceta',
    releasedAt: '2020-01-01',
    owned: 7,
    total: 100,
    pct: 7,
  });

  it('release = newest first (the historical default)', () => {
    expect(sortSetRows([a, b, c], 'release').map((r) => r.code)).toEqual(['B', 'C', 'A']);
  });

  it('pct = highest completion first', () => {
    expect(sortSetRows([a, b, c], 'pct').map((r) => r.code)).toEqual(['B', 'A', 'C']);
  });

  it('name = alphabetical', () => {
    expect(sortSetRows([b, c, a], 'name').map((r) => r.code)).toEqual(['A', 'B', 'C']);
  });

  it('total and owned sort descending', () => {
    expect(sortSetRows([a, b, c], 'total').map((r) => r.code)).toEqual(['C', 'A', 'B']);
    expect(sortSetRows([a, b, c], 'owned').map((r) => r.code)).toEqual(['B', 'C', 'A']);
  });

  it('does not mutate its input', () => {
    const input = [a, b, c];
    sortSetRows(input, 'name');
    expect(input.map((r) => r.code)).toEqual(['A', 'B', 'C']);
  });
});

describe('searchCollectionCardSets', () => {
  const collection = [
    owned('SLD', '92', { name: 'Swords to Plowshares' }),
    owned('SLD', '92', { name: 'Swords to Plowshares', finish: 'foil', foil: true }),
    owned('LEA', '161', { name: 'Swords to Plowshares' }),
    owned('ONE', '1', { name: 'Sword of Forge and Frontier' }),
    owned('LEA', '48', { name: 'Plateau' }),
  ];

  it('needs at least 3 characters', () => {
    expect(searchCollectionCardSets(collection, 'sw')).toEqual({ matches: [], total: 0 });
    expect(searchCollectionCardSets(collection, '  ').total).toBe(0);
  });

  it('groups matches by card name with one printing per set + collector number', () => {
    const { matches, total } = searchCollectionCardSets(collection, 'swords');
    expect(total).toBe(1);
    expect(matches[0].name).toBe('Swords to Plowshares');
    // Two copies of SLD #92 (foil + nonfoil) collapse to one printing, qty 2.
    expect(matches[0].printings).toEqual([
      { setCode: 'SLD', collectorNumber: '92', qty: 2 },
      { setCode: 'LEA', collectorNumber: '161', qty: 1 },
    ]);
  });

  it('ranks prefix matches before substring matches, then alphabetical', () => {
    const { matches } = searchCollectionCardSets(collection, 'swo');
    expect(matches.map((m) => m.name)).toEqual([
      'Sword of Forge and Frontier',
      'Swords to Plowshares',
    ]);
  });

  it('is case-insensitive and caps results while reporting the true total', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      owned('ONE', String(i), { name: `Swordfish ${i}` })
    );
    const { matches, total } = searchCollectionCardSets(many, 'SWORDFISH', 6);
    expect(matches).toHaveLength(6);
    expect(total).toBe(9);
  });
});
