// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EnrichedCard, SortEntry } from '@spellcontrol/binder-routing';
import { releaseDateOf } from '@spellcontrol/binder-routing';
import {
  bindersUseReleaseDates,
  decorateReleaseDates,
  getReleaseDate,
  loadReleaseDates,
  setReleaseDates,
  _resetForTests,
} from './card-release-dates';

const LS_KEY = 'spellcontrol:card-release-dates';

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'c1',
    name: 'Alpha',
    setCode: 'SLP',
    setName: 'Secret Lair Promo',
    collectorNumber: '1',
    rarity: 'rare',
    scryfallId: 'sf-1',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'plain',
    foil: false,
    finish: 'nonfoil',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  _resetForTests();
});

afterEach(() => {
  localStorage.clear();
  _resetForTests();
});

describe('setReleaseDates / getReleaseDate', () => {
  it('round-trips through localStorage', () => {
    setReleaseDates({ 'sf-1': '2026-09-11' });
    _resetForTests();
    loadReleaseDates();
    expect(getReleaseDate('sf-1')).toBe('2026-09-11');
  });

  it('ignores blank dates rather than caching an empty string', () => {
    // A blank would be truthy-cached and then beat the set/drop fallback with
    // nothing, which is how a "no date" becomes a wrong date.
    setReleaseDates({ 'sf-1': '' });
    expect(getReleaseDate('sf-1')).toBeUndefined();
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it('does not rewrite storage when every date is already cached', () => {
    // Dates are immutable, so every refresh after the first re-sends what we
    // hold; re-serializing a large map each time would jank for no gain.
    setReleaseDates({ 'sf-1': '2026-09-11' });
    const first = localStorage.getItem(LS_KEY);
    localStorage.setItem(LS_KEY, 'sentinel');
    setReleaseDates({ 'sf-1': '2026-09-11' });
    expect(localStorage.getItem(LS_KEY)).toBe('sentinel');
    expect(first).toContain('2026-09-11');
  });

  it('survives unusable storage without throwing', () => {
    localStorage.setItem(LS_KEY, '{not json');
    expect(() => loadReleaseDates()).not.toThrow();
    expect(getReleaseDate('sf-1')).toBeUndefined();
  });
});

describe('decorateReleaseDates', () => {
  it('stamps releasedAt on cards it has a date for', () => {
    setReleaseDates({ 'sf-1': '2026-09-11' });
    const [out] = decorateReleaseDates([card()]);
    expect(out.releasedAt).toBe('2026-09-11');
  });

  it('returns the input by identity when nothing is cached', () => {
    const cards = [card()];
    expect(decorateReleaseDates(cards)).toBe(cards);
  });

  it('returns the input by identity when no card matches a cached date', () => {
    setReleaseDates({ 'other-id': '2026-09-11' });
    const cards = [card()];
    expect(decorateReleaseDates(cards)).toBe(cards);
  });

  it('leaves unmatched cards untouched rather than blanking them', () => {
    setReleaseDates({ 'sf-1': '2026-09-11' });
    const [hit, miss] = decorateReleaseDates([card(), card({ scryfallId: 'sf-2' })]);
    expect(hit.releasedAt).toBe('2026-09-11');
    expect(miss.releasedAt).toBeUndefined();
  });

  // The whole point: the decorated date has to beat the set date inside the
  // engine, or a rolling container set stays collapsed onto one day.
  it('makes the sort engine date a printing individually', () => {
    const setMap = {
      SLP: { code: 'SLP', name: 'Secret Lair Promo', iconSvgUri: '', releasedAt: '2023-02-17' },
    };
    setReleaseDates({ 'sf-1': '2026-09-11' });
    const [decorated] = decorateReleaseDates([card()]);
    expect(releaseDateOf(decorated, setMap)).toBe('2026-09-11');
    expect(releaseDateOf(card(), setMap)).toBe('2023-02-17');
  });
});

describe('bindersUseReleaseDates', () => {
  const sorts = (...fields: string[]) =>
    fields.map((field) => ({ field, dir: 'asc' }) as SortEntry);

  it('is true only when a binder sorts by release date', () => {
    expect(bindersUseReleaseDates([{ sorts: sorts('setReleaseDate') }])).toBe(true);
    expect(bindersUseReleaseDates([{ sorts: sorts('color', 'setReleaseDate') }])).toBe(true);
    // Unlike the Secret Lair drop map, a set-NAME sort needs no date: a
    // printing's date never changes which set it belongs to.
    expect(bindersUseReleaseDates([{ sorts: sorts('setName') }])).toBe(false);
    expect(bindersUseReleaseDates([{ sorts: sorts('color') }])).toBe(false);
    expect(bindersUseReleaseDates([])).toBe(false);
  });

  it('tolerates a binder with no sorts at all', () => {
    expect(bindersUseReleaseDates([{}])).toBe(false);
  });
});
