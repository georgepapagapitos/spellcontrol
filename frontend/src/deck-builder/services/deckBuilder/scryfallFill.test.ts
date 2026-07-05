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
// Role map for the role-cap gate tests below — a simple name->role lookup
// standing in for validateCardRole's real oracle-text corroboration (that
// mechanism has its own dedicated tests in tagger/client.test.ts).
const ROLES: Record<string, 'ramp' | 'removal' | 'boardwipe' | 'cardDraw'> = {};
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardTags: (name: string) => TAGS[name] ?? [],
  validateCardRole: (card: { name: string }) => ROLES[card.name] ?? null,
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

beforeEach(() => {
  searchCards.mockReset();
  for (const key of Object.keys(ROLES)) delete ROLES[key];
});

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

describe('fillWithScryfall hard gates (E71 controls audit)', () => {
  // These are the gates the EDHREC-pool picker enforces that a raw Scryfall
  // query can't express — without them the fallback fill was a bypass path
  // for salt tolerance, the game-changer cap, and bracket ceilings.
  const fill = (
    gates: Parameters<typeof fillWithScryfall>[18],
    liftScoreOf?: (name: string) => number
  ) =>
    fillWithScryfall(
      't:creature',
      [],
      2,
      new Set(),
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
      undefined,
      liftScoreOf,
      gates
    );

  it('skips salt-blocked cards even with a huge lift score', async () => {
    searchCards.mockResolvedValue({ data: [sc({ name: 'Salty' }), sc({ name: 'Mild' })] });
    const out = await fill({ isSaltBlocked: (name) => name === 'Salty' }, (name) =>
      name === 'Salty' ? 99 : 0
    );
    expect(out.map((c) => c.name)).toEqual(['Mild']);
  });

  it('enforces the game-changer cap with a shared running count', async () => {
    searchCards.mockResolvedValue({
      data: [sc({ name: 'GC One' }), sc({ name: 'GC Two' }), sc({ name: 'Plain' })],
    });
    const gameChangerCount = { value: 0 };
    const out = await fill({
      gameChangerNames: new Set(['GC One', 'GC Two']),
      gameChangerCount,
      maxGameChangers: 1,
    });
    // First GC accepted (and stamped + counted), second blocked by the cap.
    expect(out.map((c) => c.name)).toEqual(['GC One', 'Plain']);
    expect(out[0].isGameChanger).toBe(true);
    expect(gameChangerCount.value).toBe(1);
  });

  it('a pre-existing game-changer count from the picking phases blocks all GCs', async () => {
    searchCards.mockResolvedValue({ data: [sc({ name: 'GC One' }), sc({ name: 'Plain' })] });
    const out = await fill({
      gameChangerNames: new Set(['GC One']),
      gameChangerCount: { value: 1 },
      maxGameChangers: 1,
    });
    expect(out.map((c) => c.name)).toEqual(['Plain']);
  });

  it('honors the bracket guard: gated cards skipped, accepted cards recorded', async () => {
    searchCards.mockResolvedValue({ data: [sc({ name: 'Stax Piece' }), sc({ name: 'Plain' })] });
    const recorded: string[] = [];
    const bracketGuard = {
      exceedsCeiling: (name: string) => name === 'Stax Piece',
      record: (name: string) => recorded.push(name),
    } as unknown as import('./bracketGuard').BracketGuard;
    const out = await fill({ bracketGuard }, (name) => (name === 'Stax Piece' ? 99 : 0));
    expect(out.map((c) => c.name)).toEqual(['Plain']);
    expect(recorded).toEqual(['Plain']);
  });

  it('no gates object leaves behavior unchanged', async () => {
    searchCards.mockResolvedValue({ data: [sc({ name: 'A' }), sc({ name: 'B' })] });
    const out = await fill(undefined);
    expect(out.map((c) => c.name)).toEqual(['A', 'B']);
  });
});

describe('fillWithScryfall role-cap gate (E77 iter-4)', () => {
  // target=1 -> tolerance = max(2, round(1*0.2)) = 2 -> cap = 3.
  const roleTargets = { ramp: 1, removal: 0, boardwipe: 0, cardDraw: 0 };

  const fillWithRoleCap = (count: number, currentRoleCounts: Record<string, number>) =>
    fillWithScryfall(
      't:creature',
      [],
      count,
      new Set(),
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
      undefined,
      undefined,
      { roleCap: { roleTargets, currentRoleCounts } }
    );

  it('skips a surplus-role candidate for a role-null one, and live-updates the shared count', async () => {
    ROLES['Ramp Extra'] = 'ramp';
    searchCards.mockResolvedValue({
      data: [sc({ name: 'Ramp Extra' }), sc({ name: 'Payoff' })],
    });
    const currentRoleCounts = { ramp: 3 }; // already at cap (target 1 + tolerance 2)
    const out = await fillWithRoleCap(1, currentRoleCounts);
    expect(out.map((c) => c.name)).toEqual(['Payoff']);
    expect(currentRoleCounts.ramp).toBe(3); // untouched — the capped card never got accepted
  });

  it('accepts a role card under the cap and increments the shared running count', async () => {
    ROLES['Ramp One'] = 'ramp';
    searchCards.mockResolvedValue({ data: [sc({ name: 'Ramp One' })] });
    const currentRoleCounts = { ramp: 0 };
    const out = await fillWithRoleCap(1, currentRoleCounts);
    expect(out.map((c) => c.name)).toEqual(['Ramp One']);
    expect(currentRoleCounts.ramp).toBe(1);
  });

  it('escape hatch: admits an over-cap candidate rather than shipping the fill short', async () => {
    ROLES['Ramp Extra'] = 'ramp';
    searchCards.mockResolvedValue({ data: [sc({ name: 'Ramp Extra' })] }); // no role-null alternative
    const currentRoleCounts = { ramp: 3 };
    const out = await fillWithRoleCap(1, currentRoleCounts);
    expect(out.map((c) => c.name)).toEqual(['Ramp Extra']);
  });

  it('escape-hatch ceiling: admits at most 3 over-cap candidates, then finishes short (iter-6 Slice B)', async () => {
    const names = ['Extra1', 'Extra2', 'Extra3', 'Extra4'];
    for (const n of names) ROLES[n] = 'ramp';
    searchCards.mockResolvedValue({ data: names.map((name) => sc({ name })) });
    const currentRoleCounts = { ramp: 3 }; // already at cap — every candidate is over-cap
    const out = await fillWithRoleCap(4, currentRoleCounts);
    // Uncapped, the hatch would admit all 4 to hit count=4 — the ceiling caps
    // it at 3 (in search order), leaving the fill 3/4 instead.
    expect(out.map((c) => c.name)).toEqual(['Extra1', 'Extra2', 'Extra3']);
  });
});
