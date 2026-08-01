import { describe, it, expect } from 'vitest';
import {
  computeHyperFocusBoosts,
  resolveHyperFocus,
  HYPER_FOCUS_EXCLUSIVE,
  HYPER_FOCUS_FAVORED,
  HYPER_FOCUS_PRESENT,
  HYPER_FOCUS_GENERIC_PENALTY,
} from './hyperFocus';
import type { Customization } from '@/deck-builder/types';

const cx = (hyperFocus?: boolean) => ({ hyperFocus }) as Pick<Customization, 'hyperFocus'>;

describe('resolveHyperFocus', () => {
  it('is OFF unless explicitly enabled', () => {
    expect(resolveHyperFocus(cx(undefined))).toBe(false);
    expect(resolveHyperFocus(cx(false))).toBe(false);
    expect(resolveHyperFocus(cx(true))).toBe(true);
  });
});

describe('computeHyperFocusBoosts', () => {
  const run = (poolNames: string[], theme: [string, number][], base: [string, number][]) =>
    computeHyperFocusBoosts({
      poolNames,
      themeInclusion: new Map(theme),
      baseInclusion: new Map(base),
    });

  it('rewards a theme-exclusive card most — it is the theme’s own identity', () => {
    const b = run(['Exclusive'], [['Exclusive', 12]], []);
    expect(b.get('Exclusive')).toBe(HYPER_FOCUS_EXCLUSIVE);
  });

  it('separates theme-favored from merely theme-present by the inclusion margin', () => {
    // 40 vs 30 clears the 5-point margin; 32 vs 30 does not.
    const b = run(
      ['Favored', 'Present'],
      [
        ['Favored', 40],
        ['Present', 32],
      ],
      [
        ['Favored', 30],
        ['Present', 30],
      ]
    );
    expect(b.get('Favored')).toBe(HYPER_FOCUS_FAVORED);
    expect(b.get('Present')).toBe(HYPER_FOCUS_PRESENT);
  });

  it('penalizes a generic staple the theme page never asked for', () => {
    const b = run(['Goodstuff'], [], [['Goodstuff', 60]]);
    expect(b.get('Goodstuff')).toBe(HYPER_FOCUS_GENERIC_PENALTY);
  });

  it('leaves a card on NEITHER page untouched — absence of data is not rejection', () => {
    // An owned-collection backfill / off-snapshot printing was never eligible to
    // appear on either page; penalizing it would punish it for our data gap.
    const b = run(['Offsnapshot'], [['Other', 10]], [['Other', 10]]);
    expect(b.has('Offsnapshot')).toBe(false);
  });

  it('only scores cards actually in the pool', () => {
    const b = run(
      ['InPool'],
      [
        ['InPool', 10],
        ['NotInPool', 90],
      ],
      []
    );
    expect(b.has('NotInPool')).toBe(false);
    expect(b.size).toBe(1);
  });

  it('ranks the four tiers strictly, so the sort order is the intended one', () => {
    expect(HYPER_FOCUS_EXCLUSIVE).toBeGreaterThan(HYPER_FOCUS_FAVORED);
    expect(HYPER_FOCUS_FAVORED).toBeGreaterThan(HYPER_FOCUS_PRESENT);
    expect(HYPER_FOCUS_PRESENT).toBeGreaterThan(0);
    expect(HYPER_FOCUS_GENERIC_PENALTY).toBeLessThan(0);
  });
});
