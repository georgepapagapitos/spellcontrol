import { describe, it, expect } from 'vitest';
import { buildSuggestionRows } from './deck-suggestions';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { ComboMatch } from '@/types/combos';

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

const opts = (
  o: Partial<{ ownedNames: Set<string>; query: string; inDeck: Set<string> }> = {}
) => ({
  ownedNames: o.ownedNames ?? new Set<string>(),
  query: o.query ?? '',
  inDeck: o.inDeck ?? new Set<string>(),
});

describe('buildSuggestionRows', () => {
  it('matches ownership case-insensitively across sources', () => {
    const { staples } = buildSuggestionRows(
      [gap('Sol Ring', 92)],
      [],
      opts({ ownedNames: new Set(['sol ring']) })
    );
    expect(staples[0].owned).toBe(true);
  });

  it('orders staples owned-first, then by inclusion %', () => {
    const { staples } = buildSuggestionRows(
      [gap('Sol Ring', 92), gap('Cyclonic Rift', 71), gap('Arcane Signet', 80)],
      [],
      opts({ ownedNames: new Set(['Cyclonic Rift']) })
    );
    expect(staples.map((s) => s.name)).toEqual(['Cyclonic Rift', 'Sol Ring', 'Arcane Signet']);
    expect(staples[0].owned).toBe(true);
  });

  it('drops cards already in the deck (case-insensitive)', () => {
    const { staples } = buildSuggestionRows(
      [gap('Sol Ring', 92), gap('Arcane Signet', 80)],
      [],
      opts({ inDeck: new Set(['sol ring']) })
    );
    expect(staples.map((s) => s.name)).toEqual(['Arcane Signet']);
  });

  it('filters by query substring (normalized) across both sections', () => {
    const { staples, combos } = buildSuggestionRows(
      [gap('Smothering Tithe', 78)],
      [combo('c1', "Thassa's Oracle", 500, ['Win the game'])],
      opts({ query: 'thassa' })
    );
    expect(staples).toHaveLength(0);
    expect(combos.map((c) => c.name)).toEqual(["Thassa's Oracle"]);
  });

  it('builds combo rows from one-away matches, sorted by popularity, with produces text', () => {
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
    const { staples, combos } = buildSuggestionRows(
      [gap('Sol Ring', 92)],
      [combo('c1', 'Sol Ring', 999, ['Infinite mana']), multiMissing],
      opts()
    );
    expect(staples.map((s) => s.name)).toEqual(['Sol Ring']);
    expect(combos).toHaveLength(0); // Sol Ring already a staple; multi-missing skipped
  });
});
