import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';

// Preserve real pure helpers (getCardPrice/getFrontFaceTypeLine drive deckFilters);
// only searchCards is stubbed so we can drive fillWithScryfall deterministically.
const searchCards = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  searchCards: (...args: unknown[]) => searchCards(...args),
}));

// buildSynergyFingerprint/synergyScore (used by the owned-only re-rank block)
// call the real tagger client by default, which has no data loaded in tests —
// stub a fixed tag-per-name map so the fingerprint re-rank is deterministic.
const TAGS: Record<string, string[]> = {
  Used: ['ramp'],
  OnTag: ['ramp'],
  OffTag: ['flying'],
};
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardTags: (name: string) => TAGS[name] ?? [],
}));

import { fillWithScryfall } from './scryfallFill';

function sc(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'id',
    oracle_id: 'oracle',
    name: 'Card',
    cmc: 3,
    type_line: 'Creature',
    oracle_text: '',
    color_identity: [],
    keywords: [],
    rarity: 'rare',
    set: 'tst',
    set_name: 'Test',
    prices: {},
    legalities: { commander: 'legal' },
    ...overrides,
  };
}

beforeEach(() => searchCards.mockReset());

describe('fillWithScryfall', () => {
  it('short-circuits without searching when count <= 0', async () => {
    const out = await fillWithScryfall('t:land', [], 0, new Set());
    expect(out).toEqual([]);
    expect(searchCards).not.toHaveBeenCalled();
  });

  it('respects count, skips used/banned, and records picked names', async () => {
    searchCards.mockResolvedValue({
      data: [sc({ name: 'A' }), sc({ name: 'Used' }), sc({ name: 'Banned' }), sc({ name: 'B' })],
    });
    const used = new Set<string>(['Used']);
    const out = await fillWithScryfall('t:creature', [], 2, used, new Set(['Banned']));
    expect(out.map((c) => c.name)).toEqual(['A', 'B']);
    expect(used.has('A')).toBe(true);
    expect(used.has('B')).toBe(true);
  });

  it('appends rarity / cmc / arena / user filters onto the query', async () => {
    searchCards.mockResolvedValue({ data: [] });
    await fillWithScryfall(
      'base',
      [],
      3,
      new Set(),
      new Set(),
      null,
      'rare',
      4,
      null,
      undefined,
      'USD',
      true,
      'set:mkm'
    );
    const sentQuery = searchCards.mock.calls[0][0] as string;
    expect(sentQuery).toContain('base');
    expect(sentQuery).toContain('r<=rare');
    expect(sentQuery).toContain('cmc<=4');
    expect(sentQuery).toContain('game:arena');
    expect(sentQuery).toContain('set:mkm');
  });

  it('treats available-only as a hard collection constraint', async () => {
    searchCards.mockResolvedValue({
      data: [sc({ name: 'Unowned Bomb' }), sc({ name: 'Owned Free' })],
    });
    const used = new Set<string>();

    const out = await fillWithScryfall(
      't:creature',
      [],
      2,
      used,
      new Set(),
      null,
      null,
      null,
      null,
      new Set(['Owned Free']),
      'USD',
      false,
      '',
      'available'
    );

    expect(out.map((c) => c.name)).toEqual(['Owned Free']);
    expect(used.has('Unowned Bomb')).toBe(false);
  });

  it('respects the optional card dependency guard', async () => {
    searchCards.mockResolvedValue({
      data: [sc({ name: 'Orphan Payoff' }), sc({ name: 'Plain Draw' })],
    });
    const used = new Set<string>();

    const out = await fillWithScryfall(
      'o:"draw"',
      [],
      1,
      used,
      new Set(),
      null,
      null,
      null,
      null,
      undefined,
      'USD',
      false,
      '',
      'full',
      false,
      false,
      (card) => card.name !== 'Orphan Payoff'
    );

    expect(out.map((c) => c.name)).toEqual(['Plain Draw']);
    expect(used.has('Orphan Payoff')).toBe(false);
  });
});

describe('fillWithScryfall lift re-rank (E71 slice 2)', () => {
  // Both re-rank tests need the owned-only gate open (constrainsToCollection)
  // AND a non-empty fingerprint (buildSynergyFingerprint(usedNames) > 0) —
  // that's the same guard the pre-lift code used, untouched by this change.
  it('lift score is the PRIMARY re-rank key, overriding the fingerprint tag match', async () => {
    searchCards.mockResolvedValue({ data: [sc({ name: 'OnTag' }), sc({ name: 'OffTag' })] });
    const used = new Set<string>(['Used']);
    const liftScoreOf = (name: string) => (name === 'OffTag' ? 10 : 0);

    const out = await fillWithScryfall(
      't:creature',
      [],
      2,
      used,
      new Set(),
      null,
      null,
      null,
      null,
      new Set(['OnTag', 'OffTag']),
      'USD',
      false,
      '',
      'available',
      false,
      false,
      undefined,
      liftScoreOf
    );

    expect(out.map((c) => c.name)).toEqual(['OffTag', 'OnTag']);
  });

  it('all-zero lift falls through to the pre-lift fingerprint order, byte-identical', async () => {
    searchCards.mockResolvedValue({ data: [sc({ name: 'OnTag' }), sc({ name: 'OffTag' })] });
    const used = new Set<string>(['Used']);

    const withZeroLift = await fillWithScryfall(
      't:creature',
      [],
      2,
      new Set(used),
      new Set(),
      null,
      null,
      null,
      null,
      new Set(['OnTag', 'OffTag']),
      'USD',
      false,
      '',
      'available',
      false,
      false,
      undefined,
      () => 0
    );
    const withoutLiftParam = await fillWithScryfall(
      't:creature',
      [],
      2,
      new Set(used),
      new Set(),
      null,
      null,
      null,
      null,
      new Set(['OnTag', 'OffTag']),
      'USD',
      false,
      '',
      'available'
    );

    expect(withZeroLift.map((c) => c.name)).toEqual(['OnTag', 'OffTag']); // tag-match wins
    expect(withZeroLift.map((c) => c.name)).toEqual(withoutLiftParam.map((c) => c.name));
  });
});
