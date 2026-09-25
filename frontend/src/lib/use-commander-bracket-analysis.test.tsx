// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pending } from '@/test/pending';
import { renderHook, act } from '@testing-library/react';
import type { Deck } from '../store/decks';
import type { ComboMatchResponse } from '../types/combos';

vi.mock('@/deck-builder/services/deckBuilder/commanderDeckAnalysis', () => ({
  analyzeCommanderDeck: vi.fn(),
  detectCombosForAnalysis: vi.fn(async () => []),
}));

import { analyzeCommanderDeck } from '@/deck-builder/services/deckBuilder/commanderDeckAnalysis';
import { useCommanderBracketAnalysis } from './use-commander-bracket-analysis';

const RESULT = {
  deckGrade: { letter: 'B', headline: 'solid' },
  bracketEstimation: { bracket: 3 } as never,
  roleTargets: { ramp: 10, removal: 8, boardwipe: 3, cardDraw: 10 },
  gapAnalysis: [{ name: 'Rhystic Study', inclusion: 60, synergy: 0.2 } as never],
  cardInclusionMap: { 'Sol Ring': 90, 'Goblin Matron': 45 },
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

// Mirrors buildSignature() in the hook — keep the leading version token in sync
// with ANALYSIS_ENGINE_VERSION there.
function sig(
  deck: Deck,
  combo: ComboMatchResponse | null = null,
  bracketOverride?: 1 | 2 | 3 | 4 | 5 | null
): string {
  return [
    'v15-combo-templates-resolved',
    deck.commander?.name ?? '',
    deck.partnerCommander?.name ?? '',
    deck.cards
      .map((c) => c.card.name)
      .sort()
      .join(','),
    // '?' = the combo match hadn't answered, which is not "no combos".
    combo
      ? combo.inDeck
          .map((m) => m.combo.id)
          .sort()
          .join(',')
      : '?',
    String(bracketOverride ?? ''),
  ].join('|');
}

function args(over: Partial<Parameters<typeof useCommanderBracketAnalysis>[0]> = {}) {
  return {
    deck: makeDeck(),
    comboData: null,
    combosLoading: false,
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

describe('useCommanderBracketAnalysis — disabled cases', () => {
  it.each([
    ['no commander', { deck: makeDeck({ commander: null }) }],
    ['format has no commander', { hasCommander: false }],
    ['no mainboard size', { mainboardSize: undefined }],
    ['null deck', { deck: null }],
  ])('does nothing for %s', async (_label, over) => {
    const a = args(over as never);
    renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(analyzeCommanderDeck).not.toHaveBeenCalled();
    expect(a.updateDeck).not.toHaveBeenCalled();
  });
});

describe('useCommanderBracketAnalysis — active', () => {
  it('runs for generated decks too (no longer manual-only)', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(RESULT as never);
    const a = args({ deck: makeDeck({ source: 'generated' }) });
    renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ gradeBracketSignature: sig(a.deck as Deck) }),
      true // silent: derived analysis must not bump updatedAt
    );
  });

  it('debounces, analyzes, and persists grade/bracket with a signature', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(RESULT as never);
    const a = args();
    renderHook(() => useCommanderBracketAnalysis(a));

    expect(analyzeCommanderDeck).not.toHaveBeenCalled(); // debounced
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        deckGrade: RESULT.deckGrade,
        bracketEstimation: RESULT.bracketEstimation,
        roleTargets: RESULT.roleTargets,
        gapAnalysis: RESULT.gapAnalysis,
        cardInclusionMap: RESULT.cardInclusionMap,
        // bracketFit defaults to null when the analysis didn't produce a plan
        // (no target set); recovered alongside win-condition detection.
        bracketFit: null,
        gradeBracketSignature: sig(a.deck as Deck),
      }),
      true // silent: derived analysis must not bump updatedAt
    );
  });

  it('skips when the signature already matches what was persisted', async () => {
    const deck = makeDeck();
    (deck as Deck).gradeBracketSignature = sig(deck);
    const a = args({ deck });
    renderHook(() => useCommanderBracketAnalysis(a));
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
    renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ gradeBracketSignature: sig(deck, combo) }),
      true // silent: derived analysis must not bump updatedAt
    );
  });

  it('does not persist (and will not retry on its own) when analysis returns null', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(null);
    const a = args();
    const { rerender } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(a.updateDeck).not.toHaveBeenCalled();

    // Same signature again → guarded by the failed-signature state.
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
    renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(a.updateDeck).not.toHaveBeenCalled();
  });
});

// ── E162: root cause + status/retry surface ─────────────────────────────────
//
// Root cause of the "permanent skeleton": `analyzeCommanderDeck` resolves to
// `null` (EDHREC unreachable, commander not found/indexed) rather than
// throwing — its own try/catch swallows every failure. Before E162 the hook
// only tracked that in a ref with no reactive signal, so `gradeBracketSignature`
// never got set AND nothing ever told the UI the attempt had failed: the caller
// had no way to distinguish "still working" from "gave up", so every consumer
// deriving its render off `!deck.gradeBracketSignature` skeletoned forever.
describe('useCommanderBracketAnalysis — status/retry (E162)', () => {
  it('reports pending while enabled with no persisted signature and no failure yet', () => {
    const a = args();
    const { result } = renderHook(() => useCommanderBracketAnalysis(a));
    expect(result.current.status).toBe('pending');
  });

  it('reports ready when the format/deck has no commander analysis to run', () => {
    const a = args({ hasCommander: false });
    const { result } = renderHook(() => useCommanderBracketAnalysis(a));
    expect(result.current.status).toBe('ready');
  });

  it('reports ready once a signature has ever persisted, even off-signature', () => {
    const deck = makeDeck();
    (deck as Deck).gradeBracketSignature = sig(deck);
    const a = args({ deck });
    const { result } = renderHook(() => useCommanderBracketAnalysis(a));
    expect(result.current.status).toBe('ready');
  });

  it('flips to error status when analysis resolves null (the reproduced root cause)', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(null);
    const a = args();
    const { result } = renderHook(() => useCommanderBracketAnalysis(a));
    expect(result.current.status).toBe('pending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.status).toBe('error');
    expect(a.updateDeck).not.toHaveBeenCalled();
  });

  it('flips to error status when analysis rejects', async () => {
    vi.mocked(analyzeCommanderDeck).mockRejectedValue(new Error('edhrec down'));
    const a = args();
    const { result } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.status).toBe('error');
  });

  it('flips to error status when the analysis stalls past the timeout ceiling', async () => {
    // A promise that never settles — simulates a hung fetch (no
    // AbortController/timeout on the EDHREC client's own fetch call).
    vi.mocked(analyzeCommanderDeck).mockReturnValue(pending(null));
    const a = args();
    const { result } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      // 500ms debounce + 20s stall ceiling.
      await vi.advanceTimersByTimeAsync(500 + 20_000);
    });
    expect(result.current.status).toBe('error');
    expect(a.updateDeck).not.toHaveBeenCalled();
  });

  it('retry() clears the failure and re-runs the analysis for the same signature', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValueOnce(null);
    const a = args();
    const { result, rerender } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(result.current.status).toBe('error');
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);

    vi.mocked(analyzeCommanderDeck).mockResolvedValueOnce(RESULT as never);
    act(() => {
      result.current.retry();
    });
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(2);
    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ gradeBracketSignature: sig(a.deck as Deck) }),
      true
    );
    // updateDeck is a mock here (no real store behind it), so the hook's own
    // `persistedSignature` input never moves — mirror what the real store
    // subscription would do (stamp the signature back onto the deck record)
    // to exercise the 'ready' transition the same way a live consumer sees it.
    (a.deck as Deck).gradeBracketSignature = sig(a.deck as Deck);
    rerender();
    expect(result.current.status).toBe('ready');
  });
});

// The Power tab read Bracket 3, then jumped to 4 once combos loaded. `comboData`
// is null both while the match is in flight and when nothing matched, so the
// analysis ran on "no combos", persisted the lower bracket over a correct one,
// and recomputed when combos landed. It now waits for the match to settle.
describe('useCommanderBracketAnalysis — waits for the combo match', () => {
  const combo = {
    inDeck: [{ combo: { id: 'cx' } }],
    oneAway: [],
    almostInCollection: [],
  } as unknown as ComboMatchResponse;

  it('does not analyze or persist while combos are loading, then runs once with them', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(RESULT as never);
    const deck = makeDeck();
    let a = args({ deck, combosLoading: true });
    const { rerender, result } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(analyzeCommanderDeck).not.toHaveBeenCalled();
    expect(a.updateDeck).not.toHaveBeenCalled();
    expect(result.current.status).toBe('pending');

    a = { ...a, comboData: combo, combosLoading: false };
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    expect(a.updateDeck).toHaveBeenCalledTimes(1);
    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ gradeBracketSignature: sig(deck, combo) }),
      true
    );
  });

  it('a persisted estimate survives a revisit: no combo-less recompute while loading', async () => {
    const deck = makeDeck();
    (deck as Deck).gradeBracketSignature = sig(deck, combo);
    let a = args({ deck, combosLoading: true });
    const { rerender, result } = renderHook(() => useCommanderBracketAnalysis(a));
    // Well past the wait cap: an existing estimate is never traded for a floor.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current.missesCombos).toBe(false);
    a = { ...a, comboData: combo, combosLoading: false };
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(analyzeCommanderDeck).not.toHaveBeenCalled();
    expect(a.updateDeck).not.toHaveBeenCalled();
  });

  it('a failed match settles and the analysis runs without combos', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(RESULT as never);
    const a = args({ comboData: null, combosLoading: false });
    renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
  });
});

describe('useCommanderBracketAnalysis — a slow combo match on a first estimate', () => {
  it('stops waiting after the cap and marks the estimate as missing combos', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(RESULT as never);
    const deck = makeDeck();
    const a = args({ deck, combosLoading: true });
    const { rerender, result } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(analyzeCommanderDeck).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000); // the cap
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500); // the debounce
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ gradeBracketSignature: sig(deck, null) }),
      true
    );

    // The store stamps the signature back; the hook reads the estimate as a floor.
    (deck as Deck).gradeBracketSignature = sig(deck, null);
    rerender();
    expect(result.current.missesCombos).toBe(true);
  });

  it('an estimate that saw the combo match is not a floor, even with no combos', () => {
    const deck = makeDeck();
    const none = {
      inDeck: [],
      oneAway: [],
      almostInCollection: [],
    } as unknown as ComboMatchResponse;
    (deck as Deck).gradeBracketSignature = sig(deck, none);
    const { result } = renderHook(() =>
      useCommanderBracketAnalysis(args({ deck, comboData: none }))
    );
    expect(result.current.missesCombos).toBe(false);
  });
});

// ── Defect 2: EDHREC unreachable no longer blanks the analysis ─────────────
//
// `analyzeCommanderDeck` now resolves to a real (partial) result — with
// `edhrecMissing: true` — instead of null when only EDHREC couldn't be
// reached. The hook must: persist it (so the Power tab shows a real bracket,
// `status` stays 'ready'), mark it distinguishably so a later FULL result for
// the exact same deck isn't mistaken for "already done", and retry EDHREC on
// the next mount without looping within the current one.
const EDHREC_MISSING_SUFFIX = '#edhrec-missing';
const PARTIAL_RESULT = {
  bracketEstimation: { bracket: 3 } as never,
  winConditions: { primary: null, secondary: [], noClearWinCondition: true } as never,
  bracketFit: null,
  edhrecMissing: true,
};

describe('useCommanderBracketAnalysis — EDHREC-missing (partial) results', () => {
  it('persists a suffixed signature and exposes edhrecMissing, with status ready', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(PARTIAL_RESULT as never);
    const deck = makeDeck();
    const a = args({ deck });
    const { result, rerender } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        bracketEstimation: PARTIAL_RESULT.bracketEstimation,
        gradeBracketSignature: `${sig(deck)}${EDHREC_MISSING_SUFFIX}`,
      }),
      true
    );

    // Mirror what the real store does: stamp the signature back onto the deck.
    (deck as Deck).gradeBracketSignature = `${sig(deck)}${EDHREC_MISSING_SUFFIX}`;
    rerender();
    expect(result.current.status).toBe('ready');
    expect(result.current.edhrecMissing).toBe(true);
  });

  it('does not refetch again within the same mount once a partial result has landed', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(PARTIAL_RESULT as never);
    const deck = makeDeck();
    let a = args({ deck });
    const { rerender } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    (deck as Deck).gradeBracketSignature = `${sig(deck)}${EDHREC_MISSING_SUFFIX}`;

    // An unrelated dependency changing (e.g. the combo match settling) must
    // not re-fire EDHREC — the plain `signature` still doesn't equal the
    // suffixed persisted one, so only the local "attempted this mount" guard
    // stops a refetch loop.
    a = { ...a, combosLoading: false };
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
  });

  it('retry() re-attempts EDHREC within the same mount', async () => {
    vi.mocked(analyzeCommanderDeck).mockResolvedValueOnce(PARTIAL_RESULT as never);
    const deck = makeDeck();
    const a = args({ deck });
    const { result, rerender } = renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    (deck as Deck).gradeBracketSignature = `${sig(deck)}${EDHREC_MISSING_SUFFIX}`;
    rerender();

    vi.mocked(analyzeCommanderDeck).mockResolvedValueOnce(RESULT as never);
    act(() => result.current.retry());
    rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(2);
    // The retry succeeded fully this time — no suffix, no longer edhrecMissing.
    expect(a.updateDeck).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ gradeBracketSignature: sig(deck) }),
      true
    );
  });

  it('a fresh mount retries EDHREC even though the persisted signature already reflects a partial result', async () => {
    const deck = makeDeck();
    // Simulate a partial result persisted in an EARLIER session/mount.
    (deck as Deck).gradeBracketSignature = `${sig(deck)}${EDHREC_MISSING_SUFFIX}`;
    vi.mocked(analyzeCommanderDeck).mockResolvedValue(RESULT as never);

    const a = args({ deck });
    renderHook(() => useCommanderBracketAnalysis(a));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // A brand-new mount's `edhrecMissingAttempted` starts null, so the guard
    // that blocked further attempts within the PREVIOUS mount doesn't apply
    // here — EDHREC gets a genuine retry, and this time it succeeds.
    expect(analyzeCommanderDeck).toHaveBeenCalledTimes(1);
    expect(a.updateDeck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ gradeBracketSignature: sig(deck) }),
      true
    );
  });
});
