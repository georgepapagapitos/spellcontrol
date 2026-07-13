import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import type { EnrichedCard } from '../types';
import type { SetMap } from './api';
import {
  completionPct,
  computeSetProgress,
  compareCollectorNumbers,
  overlaySetOwnership,
} from './set-completion';

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
