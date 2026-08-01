// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// The decks store's sync subscriber fire-and-forgets a dynamic
// `import('../lib/sync')` on every local mutation (see the E133 comment on
// `useDecksStore.subscribe` in store/decks.ts). Mock it out — same as
// store/decks.test.ts does — so these tests exercise the real mutator/touch()
// codepath without a real Capacitor/network-touching module resolving in the
// background across test boundaries.
vi.mock('./sync', () => ({
  persistDecksState: vi.fn().mockResolvedValue(undefined),
}));

import { useDecksStore, getLocalMutationToken, type Deck } from '../store/decks';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ComboMatch, ComboMatchResponse } from '../types/combos';
import { useBuildTimeNudge } from './use-build-time-nudge';

function sfCard(name: string, id = 'sf-1'): ScryfallCard {
  return { name, id } as ScryfallCard;
}

/** Minimal ComboMatch fixture — only the fields the hook actually reads
 *  (combo.id/cards/produces) matter; presentOracleIds/missingOracleIds are
 *  irrelevant to an `inDeck` entry (all pieces are present by definition). */
function comboMatch(combo: {
  id: string;
  cards: { cardName: string }[];
  produces: string[];
}): ComboMatch {
  return { combo, presentOracleIds: [], missingOracleIds: [] } as unknown as ComboMatch;
}

function makeDeck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'd1',
    source: 'manual',
    commander: { name: 'Kess, Dissident Mage' },
    cards: [],
    winConditions: undefined,
    bracketEstimation: undefined,
    ...over,
  } as unknown as Deck;
}

function combos(over: Partial<ComboMatchResponse> = {}): ComboMatchResponse {
  return {
    inDeck: [],
    oneAway: [],
    almostInCollection: [],
    almostInCollectionTotal: 0,
    source: 'local',
    ...over,
  };
}

function args(over: Partial<Parameters<typeof useBuildTimeNudge>[0]> = {}) {
  return {
    deckId: 'd1',
    deck: makeDeck(),
    comboData: null,
    mainboardTarget: 99,
    ...over,
  };
}

beforeEach(() => {
  useDecksStore.setState({ decks: [] });
});

afterEach(async () => {
  cleanup();
  // The decks store's sync subscriber schedules a dynamic `import()` per
  // mutation (mocked above, but the import machinery itself still resolves
  // on a later tick); flush it inside a real act() scope so no test leaves
  // pending async work for the NEXT test's renderHook to race against.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe('useBuildTimeNudge — arming', () => {
  it('does nothing when armed with no deck/deckId', () => {
    const { result } = renderHook(() => useBuildTimeNudge(args({ deckId: undefined, deck: null })));
    act(() => result.current.notifyMainboardAdd('Sol Ring'));
    expect(result.current.nudge).toBeNull();
  });

  it('resets any showing nudge the moment a new add is armed', () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    const combo = combos({
      inDeck: [
        comboMatch({
          id: 'c1',
          cards: [{ cardName: 'Kiki-Jiki, Mirror Breaker' }, { cardName: 'Restoration Angel' }],
          produces: ['Infinite combat damage'],
        }),
      ],
    });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Kiki-Jiki, Mirror Breaker'));
    act(() => useDecksStore.getState().addCard('d1', sfCard('Kiki-Jiki, Mirror Breaker')));
    rerender(args({ deck: useDecksStore.getState().decks[0], comboData: combo }));
    expect(result.current.nudge?.kind).toBe('combo');

    act(() => result.current.notifyMainboardAdd('Some Other Card'));
    expect(result.current.nudge).toBeNull();
  });
});

describe('useBuildTimeNudge — combo signal', () => {
  it('fires when a genuinely local add completes an in-deck combo', () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });

    act(() => result.current.notifyMainboardAdd('Kiki-Jiki, Mirror Breaker'));
    const tokenAfterArm = getLocalMutationToken('d1');

    // The real store mutator — same code path a card add takes in production.
    act(() => {
      useDecksStore.getState().addCard('d1', sfCard('Kiki-Jiki, Mirror Breaker'));
    });
    expect(getLocalMutationToken('d1')).toBeGreaterThan(tokenAfterArm);

    const combo = combos({
      inDeck: [
        comboMatch({
          id: 'c1',
          cards: [{ cardName: 'Kiki-Jiki, Mirror Breaker' }, { cardName: 'Restoration Angel' }],
          produces: ['Infinite combat damage'],
        }),
      ],
    });
    rerender(args({ deck: useDecksStore.getState().decks[0], comboData: combo }));

    expect(result.current.nudge).toEqual({
      id: 'combo-c1',
      kind: 'combo',
      headline: 'Kiki-Jiki, Mirror Breaker completes a combo',
      detail: 'Kiki-Jiki, Mirror Breaker + Restoration Angel — Infinite combat damage',
    });
  });

  it('falls back to just the card list when the combo has no `produces`', () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Piece A'));
    act(() => useDecksStore.getState().addCard('d1', sfCard('Piece A')));

    const combo = combos({
      inDeck: [comboMatch({ id: 'c2', cards: [{ cardName: 'Piece A' }], produces: [] })],
    });
    rerender(args({ deck: useDecksStore.getState().decks[0], comboData: combo }));
    expect(result.current.nudge?.detail).toBe('Piece A');
  });

  it('ignores an in-deck combo that does not involve the just-added card', () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Unrelated Card'));
    act(() => useDecksStore.getState().addCard('d1', sfCard('Unrelated Card')));

    const combo = combos({
      inDeck: [comboMatch({ id: 'c3', cards: [{ cardName: 'Some Other Piece' }], produces: [] })],
    });
    rerender(args({ deck: useDecksStore.getState().decks[0], comboData: combo }));
    expect(result.current.nudge).toBeNull();
  });
});

describe('useBuildTimeNudge — win-condition signal', () => {
  it('fires the first time the deck gets a win condition attributable to the added card', () => {
    useDecksStore.setState({
      decks: [
        makeDeck({ winConditions: { primary: null, secondary: [], noClearWinCondition: true } }),
      ],
    });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd("Thassa's Oracle"));
    act(() => {
      useDecksStore.getState().addCard('d1', sfCard("Thassa's Oracle"));
      useDecksStore.getState().updateDeck(
        'd1',
        {
          winConditions: {
            primary: {
              category: 'alt-win',
              label: 'Alt win',
              summary: 'Win by emptying your library.',
              evidence: ["Thassa's Oracle"],
              score: 10,
            },
            secondary: [],
            noClearWinCondition: false,
          },
        },
        true
      );
    });
    rerender(args({ deck: useDecksStore.getState().decks[0] }));

    expect(result.current.nudge).toEqual({
      id: 'wincon-alt-win',
      kind: 'wincon',
      headline: "Thassa's Oracle gives this deck a win condition",
      detail: 'Win by emptying your library.',
    });
  });

  it('does not fire when the deck already had a win condition before the add', () => {
    const deck = makeDeck({
      winConditions: {
        primary: {
          category: 'combat',
          label: 'Combat',
          summary: 'Beats down.',
          evidence: ['Existing Beater'],
          score: 5,
        },
        secondary: [],
        noClearWinCondition: false,
      },
    });
    useDecksStore.setState({ decks: [deck] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Another Beater'));
    act(() => useDecksStore.getState().addCard('d1', sfCard('Another Beater')));
    rerender(args({ deck: useDecksStore.getState().decks[0] }));
    expect(result.current.nudge).toBeNull();
  });

  it('does not fire when the new primary evidence does not include the added card', () => {
    useDecksStore.setState({
      decks: [
        makeDeck({ winConditions: { primary: null, secondary: [], noClearWinCondition: true } }),
      ],
    });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Bystander Card'));
    act(() => {
      useDecksStore.getState().addCard('d1', sfCard('Bystander Card'));
      useDecksStore.getState().updateDeck(
        'd1',
        {
          winConditions: {
            primary: {
              category: 'mill',
              label: 'Mill',
              summary: 'Mills the opponent.',
              evidence: ['A Totally Different Card'],
              score: 8,
            },
            secondary: [],
            noClearWinCondition: false,
          },
        },
        true
      );
    });
    rerender(args({ deck: useDecksStore.getState().decks[0] }));
    expect(result.current.nudge).toBeNull();
  });
});

describe('useBuildTimeNudge — bracket signal', () => {
  function deckWithCards(n: number, over: Partial<Deck> = {}): Deck {
    return makeDeck({
      cards: Array.from({ length: n }, (_, i) => ({ card: sfCard(`Filler ${i}`) })) as never,
      ...over,
    });
  }

  it('fires once the deck has crossed the size floor (40% of the mainboard target)', () => {
    // 39 existing + the armed add = 40 cards on a 99-card target (>= 40%).
    const deck = deckWithCards(39, {
      bracketEstimation: { bracket: 3, label: 'Bracket 3' } as never,
    });
    useDecksStore.setState({ decks: [deck] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Game Changer'));
    act(() => {
      useDecksStore.getState().addCard('d1', sfCard('Game Changer'));
      useDecksStore
        .getState()
        .updateDeck('d1', { bracketEstimation: { bracket: 4, label: 'Bracket 4' } as never }, true);
    });
    rerender(args({ deck: useDecksStore.getState().decks[0] }));
    expect(result.current.nudge).toEqual({
      id: 'bracket-4',
      kind: 'bracket',
      headline: 'Bracket estimate moved to 4',
      detail: 'Bracket 4',
    });
  });

  it('stays quiet below the size floor even when the bracket estimate moves', () => {
    // Only 4 existing + the armed add = 5 cards on a 99-card target — noise.
    const deck = deckWithCards(4, {
      bracketEstimation: { bracket: 3, label: 'Bracket 3' } as never,
    });
    useDecksStore.setState({ decks: [deck] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Game Changer'));
    act(() => {
      useDecksStore.getState().addCard('d1', sfCard('Game Changer'));
      useDecksStore
        .getState()
        .updateDeck('d1', { bracketEstimation: { bracket: 4, label: 'Bracket 4' } as never }, true);
    });
    rerender(args({ deck: useDecksStore.getState().decks[0] }));
    expect(result.current.nudge).toBeNull();
  });

  it('does not fire when the bracket estimate is unchanged', () => {
    const deck = deckWithCards(39, {
      bracketEstimation: { bracket: 3, label: 'Bracket 3' } as never,
    });
    useDecksStore.setState({ decks: [deck] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Filler Land'));
    act(() => useDecksStore.getState().addCard('d1', sfCard('Filler Land')));
    rerender(args({ deck: useDecksStore.getState().decks[0] }));
    expect(result.current.nudge).toBeNull();
  });

  it('falls back to a 99-card target when mainboardTarget is not supplied', () => {
    const deck = deckWithCards(39, {
      bracketEstimation: { bracket: 3, label: 'Bracket 3' } as never,
    });
    useDecksStore.setState({ decks: [deck] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0], mainboardTarget: undefined }),
    });
    act(() => result.current.notifyMainboardAdd('Game Changer'));
    act(() => {
      useDecksStore.getState().addCard('d1', sfCard('Game Changer'));
      useDecksStore
        .getState()
        .updateDeck('d1', { bracketEstimation: { bracket: 4, label: 'Bracket 4' } as never }, true);
    });
    rerender(args({ deck: useDecksStore.getState().decks[0], mainboardTarget: undefined }));
    expect(result.current.nudge?.kind).toBe('bracket');
  });
});

describe('useBuildTimeNudge — the local-mutation-token guard', () => {
  it('does NOT fire when the settle comes from a server-applied change with no local mutation since baseline', () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });

    act(() => result.current.notifyMainboardAdd('Kiki-Jiki, Mirror Breaker'));
    const baselineToken = getLocalMutationToken('d1');

    // Mirrors exactly what lib/sync.ts's rehydrateStoresFromIdb does on a
    // remote pull: it sets `decks` directly via setState, bypassing every
    // mutator (and thus touch()) entirely — the real non-local codepath, not
    // a hand-mocked flag. See store/decks.test.ts's own token tests for the
    // same idiom proving the store side of this contract.
    act(() => {
      useDecksStore.setState({
        decks: [
          makeDeck({
            cards: [{ card: sfCard('Kiki-Jiki, Mirror Breaker') }] as never,
            winConditions: {
              primary: {
                category: 'infinite-combo',
                label: 'Infinite combo',
                summary: 'Loops for infinite damage.',
                evidence: ['Kiki-Jiki, Mirror Breaker'],
                score: 20,
              },
              secondary: [],
              noClearWinCondition: false,
            },
          }),
        ],
      });
    });

    // The guard's premise: no genuine local mutation happened.
    expect(getLocalMutationToken('d1')).toBe(baselineToken);

    const combo = combos({
      inDeck: [
        comboMatch({
          id: 'c1',
          cards: [{ cardName: 'Kiki-Jiki, Mirror Breaker' }],
          produces: ['Infinite combat damage'],
        }),
      ],
    });
    rerender(args({ deck: useDecksStore.getState().decks[0], comboData: combo }));

    expect(result.current.nudge).toBeNull();
  });
});

describe('useBuildTimeNudge — dismiss / expiry / stale add', () => {
  it('dismiss() clears an active nudge', () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Piece A'));
    act(() => useDecksStore.getState().addCard('d1', sfCard('Piece A')));
    const combo = combos({
      inDeck: [comboMatch({ id: 'c1', cards: [{ cardName: 'Piece A' }], produces: [] })],
    });
    rerender(args({ deck: useDecksStore.getState().decks[0], comboData: combo }));
    expect(result.current.nudge).not.toBeNull();

    act(() => result.current.dismiss());
    expect(result.current.nudge).toBeNull();
  });

  it('does not fire once the arm window has expired', () => {
    vi.useFakeTimers();
    try {
      useDecksStore.setState({ decks: [makeDeck()] });
      const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
        initialProps: args({ deck: useDecksStore.getState().decks[0] }),
      });
      act(() => result.current.notifyMainboardAdd('Piece A'));
      act(() => useDecksStore.getState().addCard('d1', sfCard('Piece A')));
      act(() => vi.advanceTimersByTime(10_000));

      const combo = combos({
        inDeck: [comboMatch({ id: 'c1', cards: [{ cardName: 'Piece A' }], produces: [] })],
      });
      rerender(args({ deck: useDecksStore.getState().decks[0], comboData: combo }));
      expect(result.current.nudge).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears an armed baseline and does not fire for cards no longer in the deck', () => {
    useDecksStore.setState({ decks: [makeDeck()] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deck: useDecksStore.getState().decks[0] }),
    });
    // Armed for a card that never actually landed in `cards` (e.g. the add
    // failed or was immediately undone) — the deck passed to rerender never
    // contains it.
    act(() => result.current.notifyMainboardAdd('Ghost Card'));
    act(() => useDecksStore.getState().addCard('d1', sfCard('Unrelated Filler')));
    const combo = combos({
      inDeck: [comboMatch({ id: 'c1', cards: [{ cardName: 'Ghost Card' }], produces: [] })],
    });
    rerender(args({ deck: useDecksStore.getState().decks[0], comboData: combo }));
    expect(result.current.nudge).toBeNull();
  });

  it('drops an armed baseline when the deck id changes', () => {
    useDecksStore.setState({ decks: [makeDeck({ id: 'd1' }), makeDeck({ id: 'd2' })] });
    const { result, rerender } = renderHook((p) => useBuildTimeNudge(p), {
      initialProps: args({ deckId: 'd1', deck: useDecksStore.getState().decks[0] }),
    });
    act(() => result.current.notifyMainboardAdd('Piece A'));
    act(() => useDecksStore.getState().addCard('d1', sfCard('Piece A')));

    // Switch the hook over to a different deck entirely.
    rerender(args({ deckId: 'd2', deck: useDecksStore.getState().decks[1] }));
    const combo = combos({
      inDeck: [comboMatch({ id: 'c1', cards: [{ cardName: 'Piece A' }], produces: [] })],
    });
    rerender(args({ deckId: 'd2', deck: useDecksStore.getState().decks[1], comboData: combo }));
    expect(result.current.nudge).toBeNull();
  });
});
