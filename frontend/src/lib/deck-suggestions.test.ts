import { describe, it, expect } from 'vitest';
import { buildSuggestionRows, type SuggestionFilter } from './deck-suggestions';
import type { GapAnalysisCard, HiddenGemRow } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';
import type { ChangeOwnership } from './deck-change';

const gap = (
  name: string,
  inclusion: number,
  extra: Partial<GapAnalysisCard> = {}
): GapAnalysisCard => ({
  name,
  price: null,
  inclusion,
  synergy: 0,
  typeLine: 'Creature',
  ...extra,
});

const combo = (
  id: string,
  missingName: string,
  popularity: number,
  produces: string[]
): ComboMatch => ({
  combo: {
    id,
    identity: 'U',
    produces,
    prerequisites: null,
    description: null,
    manaNeeded: null,
    popularity,
    cardCount: 2,
    bracket: null,
    cards: [
      { oracleId: 'have-1', cardName: 'Have This', quantity: 1 },
      { oracleId: `miss-${id}`, cardName: missingName, quantity: 1 },
    ],
  },
  presentOracleIds: ['have-1'],
  missingOracleIds: [`miss-${id}`],
});

const ALL_ON: SuggestionFilter = {
  owned: true,
  inOtherDeck: true,
  inCube: true,
  unowned: true,
};

// ownershipFor backed by a name→state map; absent = unowned.
const ownership = (m: Record<string, ChangeOwnership>) => (name: string) => m[name] ?? 'unowned';

const opts = (
  o: Partial<{
    ownershipFor: (name: string) => ChangeOwnership;
    query: string;
    inDeck: Set<string>;
    show: SuggestionFilter;
    hiddenGems: HiddenGemRow[];
  }> = {}
) => ({
  ownershipFor: o.ownershipFor ?? (() => 'unowned' as ChangeOwnership),
  query: o.query ?? '',
  inDeck: o.inDeck ?? new Set<string>(),
  show: o.show ?? ALL_ON,
  hiddenGems: o.hiddenGems,
});

const gem = (name: string, extra: Partial<HiddenGemRow> = {}): HiddenGemRow => ({
  name,
  typeLine: 'Creature',
  price: null,
  signals: [{ kind: 'lift', names: ['Seed A', 'Seed B'] }],
  ...extra,
});

describe('buildSuggestionRows', () => {
  it('classifies cards into owned / in-other-deck / in-cube / unowned and counts each bucket', () => {
    const { counts } = buildSuggestionRows(
      [
        gap('Sol Ring', 92),
        gap('Cyclonic Rift', 71),
        gap('Mana Crypt', 80),
        gap('Rhystic Study', 69),
      ],
      [],
      opts({
        ownershipFor: ownership({
          'Sol Ring': 'owned',
          'Cyclonic Rift': 'in-other-deck',
          'Mana Crypt': 'in-cube',
        }),
      })
    );
    expect(counts).toEqual({ owned: 1, inOtherDeck: 1, inCube: 1, unowned: 1 });
  });

  it('labels a cube-committed card as in-cube (not unowned) and ranks it with in-other-deck', () => {
    const { staples } = buildSuggestionRows(
      [gap('Free Now', 10), gap('In Cube', 99), gap('Buy Me', 50)],
      [],
      opts({ ownershipFor: ownership({ 'Free Now': 'owned', 'In Cube': 'in-cube' }) })
    );
    // owned first, then the owned-but-committed cube card, then unowned.
    expect(staples.map((s) => s.name)).toEqual(['Free Now', 'In Cube', 'Buy Me']);
    expect(staples.find((s) => s.name === 'In Cube')?.ownership).toBe('in-cube');
  });

  it('orders staples available-first, then in-a-deck, then unowned, then by inclusion %', () => {
    const { staples } = buildSuggestionRows(
      [gap('Low Owned', 10), gap('High Unowned', 99), gap('Mid InDeck', 50)],
      [],
      opts({
        ownershipFor: ownership({ 'Low Owned': 'owned', 'Mid InDeck': 'in-other-deck' }),
      })
    );
    expect(staples.map((s) => s.name)).toEqual(['Low Owned', 'Mid InDeck', 'High Unowned']);
  });

  it('hides buckets whose toggle is off but still counts them', () => {
    const { staples, counts } = buildSuggestionRows(
      [gap('Sol Ring', 92), gap('Rhystic Study', 69)],
      [],
      opts({
        ownershipFor: ownership({ 'Sol Ring': 'owned' }),
        show: { owned: true, inOtherDeck: true, inCube: true, unowned: false },
      })
    );
    expect(staples.map((s) => s.name)).toEqual(['Sol Ring']); // unowned hidden
    expect(counts.unowned).toBe(1); // but still counted for the chip
  });

  it('treats undefined ownership as unowned', () => {
    const { counts } = buildSuggestionRows(
      [gap('Sol Ring', 92)],
      [],
      opts({ ownershipFor: () => undefined })
    );
    expect(counts.unowned).toBe(1);
  });

  it('drops cards already in the deck (case-insensitive)', () => {
    const { staples } = buildSuggestionRows(
      [gap('Sol Ring', 92), gap('Arcane Signet', 80)],
      [],
      opts({ inDeck: new Set(['sol ring']) })
    );
    expect(staples.map((s) => s.name)).toEqual(['Arcane Signet']);
  });

  it('filters by query substring across both sections', () => {
    const { staples, combos } = buildSuggestionRows(
      [gap('Smothering Tithe', 78)],
      [combo('c1', "Thassa's Oracle", 500, ['Win the game'])],
      opts({ query: 'thassa' })
    );
    expect(staples).toHaveLength(0);
    expect(combos.map((c) => c.name)).toEqual(["Thassa's Oracle"]);
  });

  it('within the same payoff tier, builds combo rows sorted by popularity with produces text', () => {
    const { combos } = buildSuggestionRows(
      [],
      [
        combo('c1', 'Demonic Consultation', 100, ['Infinite mana']),
        combo('c2', 'Tainted Pact', 400, ['Infinite mana', 'Infinite draw']),
      ],
      opts()
    );
    expect(combos.map((c) => c.name)).toEqual(['Tainted Pact', 'Demonic Consultation']);
    expect(combos[0].produces).toBe('Infinite mana + Infinite draw');
  });

  it('ranks by payoff quality (E83) ahead of raw popularity', () => {
    const { combos } = buildSuggestionRows(
      [],
      [
        combo('c1', 'Value Card', 9999, ['Gain infinite life']),
        combo('c2', 'Win Card', 5, ['Win the game']),
      ],
      opts()
    );
    // The outright win ranks first despite far lower popularity.
    expect(combos.map((c) => c.name)).toEqual(['Win Card', 'Value Card']);
  });

  it('does not duplicate a card across staples and combos, and ignores multi-missing combos', () => {
    const multiMissing: ComboMatch = {
      ...combo('c3', 'Other', 10, ['x']),
      missingOracleIds: ['a', 'b'],
    };
    const { staples, combos, counts } = buildSuggestionRows(
      [gap('Sol Ring', 92)],
      [combo('c1', 'Sol Ring', 999, ['Infinite mana']), multiMissing],
      opts()
    );
    expect(staples.map((s) => s.name)).toEqual(['Sol Ring']);
    expect(combos).toHaveLength(0);
    expect(counts.unowned).toBe(1); // Sol Ring counted once, multi-missing not at all
  });

  it('returns hidden gems as their own section, carrying signals and price', () => {
    const { gems, counts } = buildSuggestionRows(
      [],
      [],
      opts({
        hiddenGems: [gem('Mystic Remora', { price: '1.50' })],
      })
    );
    expect(gems).toHaveLength(1);
    expect(gems[0]).toMatchObject({
      name: 'Mystic Remora',
      kind: 'gem',
      ownership: 'unowned',
      price: '1.50',
      signals: [{ kind: 'lift', names: ['Seed A', 'Seed B'] }],
    });
    expect(counts.unowned).toBe(1);
  });

  it('sorts gems availability-first while preserving engine order within a bucket', () => {
    const { gems } = buildSuggestionRows(
      [],
      [],
      opts({
        hiddenGems: [gem('First Unowned'), gem('Second Unowned'), gem('Owned Gem')],
        ownershipFor: ownership({ 'Owned Gem': 'owned' }),
      })
    );
    expect(gems.map((g) => g.name)).toEqual(['Owned Gem', 'First Unowned', 'Second Unowned']);
  });

  it('drops a gem that is already in the deck, shown as a staple, or filtered out', () => {
    const { gems, counts } = buildSuggestionRows(
      [gap('Staple Gem', 42)],
      [],
      opts({
        hiddenGems: [gem('Staple Gem'), gem('In Deck Gem'), gem('Kept Gem')],
        inDeck: new Set(['in deck gem']),
      })
    );
    expect(gems.map((g) => g.name)).toEqual(['Kept Gem']);
    // Staple Gem counted once (as a staple); In Deck Gem not at all.
    expect(counts.unowned).toBe(2);
  });

  it('applies the query and availability filters to gems like any other row', () => {
    const { gems } = buildSuggestionRows(
      [],
      [],
      opts({
        hiddenGems: [gem('Mystic Remora'), gem('Blood Artist')],
        query: 'remora',
      })
    );
    expect(gems.map((g) => g.name)).toEqual(['Mystic Remora']);

    const hidden = buildSuggestionRows(
      [],
      [],
      opts({
        hiddenGems: [gem('Mystic Remora')],
        show: { ...ALL_ON, unowned: false },
      })
    );
    expect(hidden.gems).toHaveLength(0);
    expect(hidden.counts.unowned).toBe(1); // still counted for the chip
  });
});
