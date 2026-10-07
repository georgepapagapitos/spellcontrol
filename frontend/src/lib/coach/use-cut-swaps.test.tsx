// @vitest-environment happy-dom
//
// The Cuts lane's pairing hook (E540 S6): its states, and that a deck the
// objective cannot score falls back to today's rows instead of a blank lane.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deck } from '@/store/decks';
import type { Change } from './deck-change';
import type { CutOutcome } from './coach-cut-swaps';
import { useCutSwaps, type CutSwapEnv, type CutSwapSources } from './use-cut-swaps';

const loadCoachObjective = vi.fn();
vi.mock('./coach-objective', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./coach-objective')>()),
  loadCoachObjective: (...a: unknown[]) => loadCoachObjective(...a),
}));
const pairCuts = vi.fn();
vi.mock('./coach-cut-swaps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./coach-cut-swaps')>()),
  pairCuts: (...a: unknown[]) => pairCuts(...a),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCachedCard: () => undefined,
  getCardsByNames: async () => new Map(),
  getGameChangerNames: async () => new Set<string>(),
}));

const cut = (name: string): Change => ({
  id: `upgrade:cut:${name}`,
  type: 'cut',
  lane: 'upgrade',
  name,
});
const deck = (names: string[]) =>
  ({
    format: 'commander',
    commander: { name: 'Meren of Clan Nel Toth' },
    partnerCommander: null,
    cards: names.map((n, i) => ({ slotId: String(i), card: { name: n } })),
    roleTargets: { ramp: 10 },
    bracketOverride: null,
  }) as unknown as Deck;
const sources = (names: string[]): CutSwapSources => ({
  deck: deck(names),
  combos: null,
  owned: [],
});
const env: CutSwapEnv = { resolveOwnership: () => undefined };

beforeEach(() => {
  loadCoachObjective.mockReset();
  pairCuts.mockReset();
});

describe('useCutSwaps', () => {
  it('is idle with no cuts or no deck to read', () => {
    const none = renderHook(() => useCutSwaps([], sources(['A']), env));
    expect(none.result.current.state).toEqual({ status: 'idle' });
    const noDeck = renderHook(() => useCutSwaps([cut('A')], undefined, env));
    expect(noDeck.result.current.state).toEqual({ status: 'idle' });
    expect(loadCoachObjective).not.toHaveBeenCalled();
  });

  it('waits for the deck’s combos instead of pairing twice', async () => {
    loadCoachObjective.mockResolvedValue({ ok: false, reason: 'no-page' });
    const { result, rerender } = renderHook(
      ({ hold }) => useCutSwaps([cut('A')], sources(['A']), env, hold),
      { initialProps: { hold: true } }
    );
    // Still loading (the lane shows its skeleton), and nothing has run yet.
    expect(result.current.state).toEqual({ status: 'loading' });
    expect(loadCoachObjective).not.toHaveBeenCalled();
    rerender({ hold: false });
    await waitFor(() => expect(result.current.state.status).toBe('fallback'));
    expect(loadCoachObjective).toHaveBeenCalledTimes(1);
  });

  it('gives up on slow combos at the budget and keeps today’s rows', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCutSwaps([cut('A')], sources(['A']), env, true));
      expect(result.current.state).toEqual({ status: 'loading' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4001);
      });
      expect(result.current.state).toEqual({ status: 'fallback', reason: 'combos-slow' });
      expect(loadCoachObjective).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads, then reports the verdicts per cut', async () => {
    loadCoachObjective.mockResolvedValue({
      ok: true,
      ctx: { edhrec: new Map() },
      deck: { commanders: [], cards: [] },
      pageRows: 300,
    });
    const verdicts = new Map<string, CutOutcome>([
      ['upgrade:cut:A', { status: 'none', reason: 'x' }],
    ]);
    pairCuts.mockResolvedValue(verdicts);
    const { result } = renderHook(() => useCutSwaps([cut('A')], sources(['A']), env));
    expect(result.current.state).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toEqual({ status: 'ready', outcomes: verdicts });
    // The pairing runs under the app's 4 s budget.
    expect(pairCuts.mock.calls[0][1].budgetMs).toBeLessThanOrEqual(4000);
  });

  it.each(['no-page', 'thin-page'] as const)(
    'falls back to today’s rows for a deck with a %s',
    async (reason) => {
      loadCoachObjective.mockResolvedValue({ ok: false, reason });
      const { result } = renderHook(() => useCutSwaps([cut('A')], sources(['A']), env));
      await waitFor(() => expect(result.current.state.status).toBe('fallback'));
      expect(result.current.state).toEqual({ status: 'fallback', reason });
      expect(pairCuts).not.toHaveBeenCalled();
    }
  );

  it('reports an error when the pairing throws, and retries on request', async () => {
    loadCoachObjective.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCutSwaps([cut('A')], sources(['A']), env));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    loadCoachObjective.mockResolvedValue({ ok: false, reason: 'no-page' });
    result.current.retry();
    await waitFor(() => expect(result.current.state.status).toBe('fallback'));
  });

  it('keeps the last verdicts on screen while a changed deck is re-paired', async () => {
    loadCoachObjective.mockResolvedValue({
      ok: true,
      ctx: { edhrec: new Map() },
      deck: { commanders: [], cards: [] },
      pageRows: 300,
    });
    const first = new Map<string, CutOutcome>([['upgrade:cut:A', { status: 'none', reason: 'x' }]]);
    pairCuts.mockResolvedValueOnce(first);
    let release: (m: Map<string, CutOutcome>) => void = () => {};
    pairCuts.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const { result, rerender } = renderHook(
      ({ names }) => useCutSwaps([cut('A'), cut('B')], sources(names), env),
      { initialProps: { names: ['A', 'B'] } }
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    rerender({ names: ['A', 'B', 'C'] });
    // The deck changed (an apply): the old verdicts stay, no skeleton flashes.
    expect(result.current.state).toEqual({ status: 'ready', outcomes: first });
    await waitFor(() => expect(pairCuts).toHaveBeenCalledTimes(2));
    release(new Map());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', outcomes: first }));
  });
});
