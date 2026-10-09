import { describe, expect, it } from 'vitest';
import { pickClosestDrop } from './sld-drops';

// Snapshot order is newest first.
// SLD #523 as the real snapshot lists it: Ral, Storm Conduit printed 2019-12-16.
const RAL = [
  { name: 'Year of the Rat', releasedAt: '2020-01-07' },
  { name: 'Kaleidoscope Killers', releasedAt: '2019-12-08' },
  { name: 'Bitterblossom Dreams', releasedAt: '2019-12-03' },
];

describe('pickClosestDrop', () => {
  it('picks the drop closest to the printing date (Ral #523, printed 2019-12-16)', () => {
    expect(pickClosestDrop(RAL, '2019-12-16')?.name).toBe('Kaleidoscope Killers');
    expect(pickClosestDrop(RAL, '2020-01-07')?.name).toBe('Year of the Rat');
  });

  it('falls back to the first (newest) candidate when the printing date is unknown', () => {
    expect(pickClosestDrop(RAL, undefined)?.name).toBe('Year of the Rat');
    expect(pickClosestDrop(RAL, '')?.name).toBe('Year of the Rat');
    expect(pickClosestDrop(RAL, 'not-a-date')?.name).toBe('Year of the Rat');
  });

  it('breaks an exact tie toward the earlier-listed candidate', () => {
    const tie = [
      { name: 'A', releasedAt: '2023-05-01' },
      { name: 'B', releasedAt: '2023-05-01' },
    ];
    expect(pickClosestDrop(tie, '2023-05-01')?.name).toBe('A');
  });

  it('ignores undated candidates while a dated one exists', () => {
    const c = [
      { name: 'Undated', releasedAt: '' },
      { name: 'Dated', releasedAt: '2021-01-01' },
    ];
    expect(pickClosestDrop(c, '2030-01-01')?.name).toBe('Dated');
  });

  it('keeps the head when every candidate is undated; handles empty and single', () => {
    expect(
      pickClosestDrop(
        [
          { name: 'X', releasedAt: '' },
          { name: 'Y', releasedAt: '' },
        ],
        '2020-01-01'
      )?.name
    ).toBe('X');
    expect(pickClosestDrop([], '2020-01-01')).toBeUndefined();
    expect(pickClosestDrop([{ name: 'Only', releasedAt: '2000-01-01' }], '2020-01-01')?.name).toBe(
      'Only'
    );
  });
});
