import { describe, it, expect } from 'vitest';
import { buildSuggestionRows, type SuggestionFilter } from './deck-suggestions';
import type { GapAnalysisCard } from '@/deck-builder/types';
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

const ALL_ON: SuggestionFilter = { owned: true, inOtherDeck: true, unowned: true };

// ownershipFor backed by a name→state map; absent = unowned.
const ownership = (m: Record<string, ChangeOwnership>) => (name: string) => m[name] ?? 'unowned';

const opts = (
  o: Partial<{
    ownershipFor: (name: string) => ChangeOwnership;
    query: string;
    inDeck: Set<string>;
    show: SuggestionFilter;
  }> = {}
) => ({
  ownershipFor: o.ownershipFor ?? (() => 'unowned' as ChangeOwnership),
  query: o.query ?? '',
  inDeck: o.inDeck ?? new Set<string>(),
  show: o.show ?? ALL_ON,
});

describe('buildSuggestionRows', () => {
  it('classifies cards into owned / in-other-deck / unowned and counts each bucket', () => {
    const { counts } = buildSuggestionRows(
      [gap('Sol Ring', 92), gap('Cyclonic Rift', 71), gap('Rhystic Study', 69)],
      [],
      opts({ ownershipFor: ownership({ 'Sol Ring': 'owned', 'Cyclonic Rift': 'in-other-deck' }) })
    );
    expect(counts).toEqual({ owned: 1, inOtherDeck: 1, unowned: 1 });
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
        show: { owned: true, inOtherDeck: true, unowned: false },
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

  it('builds combo rows sorted by popularity with produces text', () => {
    const { combos } = buildSuggestionRows(
      [],
      [
        combo('c1', 'Demonic Consultation', 100, ['Win the game']),
        combo('c2', 'Tainted Pact', 400, ['Win', 'the game']),
      ],
      opts()
    );
    expect(combos.map((c) => c.name)).toEqual(['Tainted Pact', 'Demonic Consultation']);
    expect(combos[0].produces).toBe('Win + the game');
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
});
