// @vitest-environment happy-dom
/**
 * Defect 1 end to end at the hook boundary: a combo completed only via a
 * sideboard card must never set a bracket floor. The hook itself has no
 * notion of deck zones — it just turns `comboData.inDeck` into
 * `DetectedCombo`s (via the REAL `comboMatchesToDetected`, unmocked here) and
 * hands them to `analyzeCommanderDeck`. What actually removes the floor is
 * DeckEditorPage wiring `partitionCombosByZone` / `toMainboardComboData` in
 * front of this hook — this test proves that wiring, not just the partition
 * helper in isolation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import type { Deck } from '../store/decks';
import type { ComboMatchResponse } from '../types/combos';
import { partitionCombosByZone, toMainboardComboData } from './combo-zone-partition';

const analyzeCommanderDeck = vi.fn();

vi.mock('@/deck-builder/services/deckBuilder/commanderDeckAnalysis', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/deck-builder/services/deckBuilder/commanderDeckAnalysis')
    >();
  return { ...actual, analyzeCommanderDeck: (...args: unknown[]) => analyzeCommanderDeck(...args) };
});

import { useCommanderBracketAnalysis } from './use-commander-bracket-analysis';

function makeDeck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    commander: { name: 'Kess, Dissident Mage', oracle_id: 'kess-oracle' },
    partnerCommander: null,
    cards: [{ card: { name: 'Exquisite Blood', oracle_id: 'o1' } }],
    gradeBracketSignature: undefined,
    ...over,
  } as unknown as Deck;
}

/** A complete combo whose second piece (Sanguine Bond) lives only in the
 *  sideboard — the raw response the combos panel's match query returns
 *  (matched against the WHOLE deck, sideboard included). */
function rawComboResponse(): ComboMatchResponse {
  return {
    inDeck: [
      {
        combo: {
          id: 'c1',
          identity: 'wb',
          produces: ['Infinite drain'],
          prerequisites: null,
          description: null,
          manaNeeded: null,
          popularity: 100,
          cardCount: 2,
          bracket: 3,
          cards: [
            { oracleId: 'o1', cardName: 'Exquisite Blood', quantity: 1 },
            { oracleId: 'o2', cardName: 'Sanguine Bond', quantity: 1 },
          ],
        },
        presentOracleIds: ['o1', 'o2'],
        missingOracleIds: [],
      },
    ],
    oneAway: [],
    almostInCollection: [],
    source: 'local',
    almostInCollectionTotal: 0,
  };
}

function args(over: Partial<Parameters<typeof useCommanderBracketAnalysis>[0]> = {}) {
  return {
    deck: makeDeck(),
    comboData: null,
    combosLoading: false,
    mainboardSize: 99,
    hasCommander: true,
    colorIdentity: ['W', 'B'],
    updateDeck: vi.fn(),
    ...over,
  };
}

afterEach(() => {
  cleanup();
  analyzeCommanderDeck.mockReset();
});

describe('useCommanderBracketAnalysis — sideboard combos never set a floor', () => {
  it('feeds the combo as a detected combo when given the raw (unpartitioned) response', async () => {
    analyzeCommanderDeck.mockResolvedValue({
      bracketEstimation: { bracket: 4, label: 'Bracket 4', hardFloors: [], softScore: 0 },
      winConditions: undefined,
      bracketFit: null,
    });
    const updateDeck = vi.fn();
    renderHook(() =>
      useCommanderBracketAnalysis(args({ comboData: rawComboResponse(), updateDeck }))
    );

    await waitFor(() => expect(analyzeCommanderDeck).toHaveBeenCalled());
    const call = analyzeCommanderDeck.mock.calls[0][0] as { detectedCombos: unknown[] };
    expect(call.detectedCombos).toHaveLength(1);
  });

  it('drops the combo entirely once partitioned to the mainboard view — no floor', async () => {
    analyzeCommanderDeck.mockResolvedValue({
      bracketEstimation: { bracket: 2, label: 'Bracket 2', hardFloors: [], softScore: 0 },
      winConditions: undefined,
      bracketFit: null,
    });
    const updateDeck = vi.fn();
    const mainboardOracleIds = new Set(['kess-oracle', 'o1']); // NOT o2 (Sanguine Bond)
    const partitioned = partitionCombosByZone(rawComboResponse(), mainboardOracleIds);
    // The combo is real and complete — just not on the mainboard side.
    expect(partitioned.sideboardComplete).toHaveLength(1);
    expect(partitioned.mainboardComplete).toHaveLength(0);
    const mainboardComboData = toMainboardComboData(rawComboResponse(), partitioned);

    renderHook(() =>
      useCommanderBracketAnalysis(args({ comboData: mainboardComboData, updateDeck }))
    );

    await waitFor(() => expect(analyzeCommanderDeck).toHaveBeenCalled());
    const call = analyzeCommanderDeck.mock.calls[0][0] as { detectedCombos: unknown[] };
    expect(call.detectedCombos).toHaveLength(0);

    await waitFor(() => expect(updateDeck).toHaveBeenCalled());
    const [, updates] = updateDeck.mock.calls[0] as [
      string,
      { bracketEstimation: { bracket: number } },
    ];
    expect(updates.bracketEstimation.bracket).toBe(2);
  });
});
