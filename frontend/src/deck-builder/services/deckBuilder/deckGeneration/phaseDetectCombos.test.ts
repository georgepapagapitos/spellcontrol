import { describe, it, expect } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { detectCombosPhase, refreshComboCompleteness } from './phaseDetectCombos';
import type { GenerationState } from './state';

function scryfallCard(name: string): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Instant',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: { usd: '1.00' },
    legalities: { commander: 'legal' },
  } as unknown as ScryfallCard;
}

function makeState(cards: ScryfallCard[]): GenerationState {
  return {
    context: {
      commander: scryfallCard('Test Commander'),
      partnerCommander: null,
      colorIdentity: [],
      customization: {} as GenerationState['context']['customization'],
    },
    bannedCards: new Set<string>(),
    categories: {
      lands: [],
      ramp: [],
      cardDraw: [],
      singleRemoval: [],
      boardWipes: [],
      creatures: [],
      synergy: cards,
      utility: [],
    },
    combos: [
      {
        comboId: 'doomsday-thassa',
        cards: [
          { name: 'Doomsday', id: 'a' },
          { name: "Thassa's Oracle", id: 'b' },
        ],
        results: ['Win the game'],
        deckCount: 13598,
        rank: 50,
        bracket: null,
        bracketTag: null,
        prereqCount: 0,
        cardCount: 2,
        href: null,
      },
    ],
  } as unknown as GenerationState;
}

describe('refreshComboCompleteness', () => {
  it('is an exact no-op (returns the same undefined) when there is nothing to refresh', () => {
    const state = makeState([scryfallCard('Doomsday'), scryfallCard("Thassa's Oracle")]);
    expect(refreshComboCompleteness(undefined, state)).toBeUndefined();
  });

  it('marks a combo not-complete once a reconcile/trim cut removes one of its pieces', () => {
    const state = makeState([scryfallCard('Doomsday'), scryfallCard("Thassa's Oracle")]);
    const detected = detectCombosPhase(state);
    expect(detected?.find((dc) => dc.comboId === 'doomsday-thassa')?.isComplete).toBe(true);

    // Simulate a later cut (reconcile/Smart Trim/coherence repair) removing
    // Doomsday from the final deck without ever refreshing detectedCombos —
    // the exact staleness class this recompute closes.
    state.categories.synergy = state.categories.synergy.filter((c) => c.name !== 'Doomsday');

    const refreshed = refreshComboCompleteness(detected, state);
    const combo = refreshed?.find((dc) => dc.comboId === 'doomsday-thassa');
    expect(combo?.isComplete).toBe(false);
    expect(combo?.missingCards).toEqual(['Doomsday']);
  });
});
