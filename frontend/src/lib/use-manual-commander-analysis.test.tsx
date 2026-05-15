// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Deck } from '../store/decks';
import type { ComboMatchResponse } from '../types/combos';

vi.mock('@/deck-builder/services/deckBuilder/commanderDeckAnalysis', () => ({
  analyzeCommanderDeck: vi.fn(),
  comboMatchesToDetected: vi.fn(() => []),
}));

import { analyzeCommanderDeck } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { useManualCommanderAnalysis } from './use-manual-commander-analysis';

const RESULT = {
  deckGrade: { letter: 'B', headline: 'solid' },
  bracketEstimation: { bracket: 3 } as never,
};

function makeDeck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    source: 'manual',
    commander: { name: 'Krenko, Mob Boss' },
    partnerCommander: null,
    cards: [{ card: { name: 'Sol Ring' } }, { card: { name: 'Goblin Matron' } }],
    ...over,
  } as unknown as Deck;
}

// Mirrors buildSignature() in the hook.
function sig(deck: Deck, combo: ComboMatchResponse | null = null): string {
  return [
    deck.commander?.name ?? '',
    deck.partnerCommander?.name ?? '',
    deck.cards
      .map((c) => c.card.name)
      .sort()
      .join(','),
    (combo?.inDeck ?? [])
      .map((m) => m.combo.id)
      .sort()
      .join(','),
  ].join('|');
}

function args(over: Partial<Parameters<typeof useManualCommanderAnalysis>[0]> = {}) {
  return {
    deck: makeDeck(),
    comboData: null,
    mainboardSize: 99,
    hasCommander: true,
    colorIdentity: ['R'],
    updateDeck: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(analyzeCommanderDeck).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useManualCommanderAnalysis — disabled cases', () => {
  it.each([
    ['generated source', { deck: makeDeck({ source: 'generated' }) }],
    ['no commander', { deck: makeDeck({ commander: null }) }],
    ['format has no commander', { hasCommander: false }],
    ['no mainboard size', { mainboardSize: undefined }],
    ['null deck', { deck: null }],
  ])('does nothing for %s', async (_label, over) => {
    const a = args(over as never);
    renderHook(() => useManualCommanderAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(analyzeCommanderDeck).not.toHaveBeenCalled();
    expect(a.updateDeck).not.toHaveBeenCalled();
  });
});

describe('useManualCommanderAnalysis — active', () => {
  it('debounces, analyzes, and persists grade/bracket with a signature', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(RESULT as never);
    const a = args();
    renderHook(() => useManualCommanderAnalysis(a));

    expect(analyzeCommanderDeck).not.toHaveBeenCalled(); // debounced
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    expect(a.updateDeck).toHaveBeenCalledWith('d1', {
      deckGrade: RESULT.deckGrade,
      bracketEstimation: RESULT.bracketEstimation,
      gradeBracketSignature: sig(a.deck as Deck),
    });
  });

  it('skips when the signature already matches what was persisted', async () => {
    const deck = makeDeck();
    (deck as Deck).gradeBracketSignature = sig(deck);
    const a = args({ deck });
    renderHook(() => useManualCommanderAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(analyzeCommanderDeck).not.toHaveBeenCalled();
  });

  it('includes partner + combo ids in the signature and still runs', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(RESULT as never);
    const combo = {
      inDeck: [{ combo: { id: 'cx' } }],
      oneAway: [],
      almostInCollection: [],
    } as unknown as ComboMatchResponse;
    const deck = makeDeck({ partnerCommander: { name: 'Tymna' } as never });
    const a = args({ deck, comboData: combo });
    renderHook(() => useManualCommanderAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ gradeBracketSignature: sig(deck, combo) })
    );
  });

  it('does not persist (and will not retry) when analysis returns null', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(null);
    const a = args();
    const { rerender } = renderHook(() => useManualCommanderAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(a.updateDeck).not.toHaveBeenCalled();

    // Same signature again → guarded by the failed-signature ref.
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    expect(a.updateDeck).not.toHaveBeenCalled();
  });

  it('swallows analysis errors without persisting', async () => {
    vi.mocked(analyzeCommanderDeck).mockRejectedValue(new Error('edhrec down'));
    const a = args();
    renderHook(() => useManualCommanderAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(a.updateDeck).not.toHaveBeenCalled();
  });
});
