// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlaytestCard } from '@/lib/playtest';
import { usePlaytestStore } from '../store';
import { usePlayStore } from '@/store/play';
import type { GameRequest } from '@/lib/games-api';
import { useTakeback } from './use-takeback';
import type { OnlineTable } from './use-online-table';

function card(id: string): PlaytestCard {
  return { id, name: `Card ${id}` };
}
function deck(n: number): PlaytestCard[] {
  return Array.from({ length: n }, (_, i) => card(`c${i}`));
}

function seatedTable(mySeat = 0): OnlineTable {
  return { activeSeat: null, opponents: [], mySeat };
}

function request(overrides: Partial<GameRequest> = {}): GameRequest {
  return {
    id: 'req1',
    code: 'ABCD',
    kind: 'rewind',
    payload: { steps: 1, summary: 'Your life: 20 → 19' },
    requesterSeat: 0,
    approvals: {},
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  usePlaytestStore.getState().teardown();
  usePlaytestStore.getState().init('deck1', { library: deck(20), seed: 1, openingHandSize: 7 });
  usePlaytestStore.setState({ takebackMode: 'ask' });
  usePlayStore.setState({
    online: null,
    onlineRequests: {},
    raiseGameRequest: vi.fn(),
    cancelGameRequest: vi.fn(),
    respondGameRequest: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Pushes a 'consent'-tier action (ADJUST_LIFE) onto the real undo stack, via
 *  the real store — exercises the actual rewindTrail-building code, not a
 *  hand-built fixture. */
function pushConsentStep() {
  act(() => {
    usePlaytestStore.getState().dispatch({ type: 'ADJUST_LIFE', player: 'self', delta: -1 });
  });
}

/** Pushes a 'locked'-tier action (DRAW). */
function pushLockedStep() {
  act(() => {
    usePlaytestStore.getState().dispatch({ type: 'DRAW', n: 1 });
  });
}

/** Pushes a 'free'-tier action that always mutates state (unlike UNTAP_ALL,
 *  which no-ops — and pushes nothing — when nothing was tapped). */
function pushFreeStep() {
  act(() => {
    usePlaytestStore.getState().dispatch({ type: 'ADJUST_MANA', color: 'W', delta: 1 });
  });
}

/**
 * The real `raiseGameRequest` store action also writes the created request
 * into `onlineRequests` as a side effect (`applyServerRequest`) — a bare
 * `vi.fn().mockResolvedValue(...)` swap only returns the value, so tests
 * that need `onlineRequests` populated (anything checking `pendingRequest`)
 * use this instead.
 */
function mockRaise(req: GameRequest = request()) {
  return vi.fn().mockImplementation(async () => {
    usePlayStore.setState((s) => ({
      onlineRequests: { ...s.onlineRequests, [req.requesterSeat]: req },
    }));
    return req;
  });
}

describe('useTakeback', () => {
  it('never offers a locked step: verdict/plan report blocked with zero steps', () => {
    pushLockedStep();
    const { result } = renderHook(() => useTakeback(null));
    expect(result.current.verdict).toBe('locked');
    expect(result.current.stepsAvailable).toBe(0);
    expect(result.current.plan).toBe('blocked');
  });

  it('surfaces the boundary reason to the user', () => {
    pushLockedStep();
    const { result } = renderHook(() => useTakeback(null));
    expect(result.current.boundaryReason).toMatch(/draw/i);
  });

  it('offers exactly the reachable steps ahead of a locked wall', () => {
    pushLockedStep(); // wall
    pushConsentStep(); // reachable
    const { result } = renderHook(() => useTakeback(null));
    expect(result.current.stepsAvailable).toBe(1);
    expect(result.current.verdict).toBe('consent');
  });

  it('off disables takebacks entirely, even for an otherwise-free step', () => {
    pushFreeStep();
    usePlaytestStore.setState({ takebackMode: 'off' });
    const { result } = renderHook(() => useTakeback(null));
    expect(result.current.verdict).toBe('free'); // the step itself is still free...
    expect(result.current.plan).toBe('blocked'); // ...but Off blocks acting on it
    act(() => {
      result.current.attempt();
    });
    expect(usePlaytestStore.getState().state!.past.length).toBeGreaterThan(0); // untouched
  });

  it('Free mode does NOT bypass a locked step (direct assertion, the rule that must not break)', () => {
    pushLockedStep();
    usePlaytestStore.setState({ takebackMode: 'free' });
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    const { result } = renderHook(() => useTakeback(seatedTable()));
    expect(result.current.plan).toBe('blocked');
    act(() => {
      const outcome = result.current.attempt();
      expect(outcome).toBe('blocked');
    });
    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore);
  });

  it('solo: a consent step applies immediately with no network call', () => {
    pushConsentStep();
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    const raise = usePlayStore.getState().raiseGameRequest;
    const { result } = renderHook(() => useTakeback(null));
    expect(result.current.plan).toBe('apply');
    act(() => {
      result.current.attempt();
    });
    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore - 1);
    expect(raise).not.toHaveBeenCalled();
  });

  it('online + Ask: a consent step raises a request and does not mutate the board until approval', async () => {
    pushConsentStep();
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    const raise = mockRaise();
    usePlayStore.setState({ raiseGameRequest: raise });

    const { result, rerender } = renderHook(() => useTakeback(seatedTable(0)));
    expect(result.current.plan).toBe('request');

    await act(async () => {
      result.current.attempt();
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    expect(raise).toHaveBeenCalledWith('rewind', { steps: 1, summary: 'Your life: 20 → 19' });
    // Board untouched — the rewind only applies on approval.
    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore);
    expect(result.current.pendingRequest?.status).toBe('pending');

    // Approval lands via the real-time transport (simulated here directly on
    // the store, same shape `applyServerRequest` writes).
    await act(async () => {
      usePlayStore.setState({ onlineRequests: { 0: request({ status: 'approved' }) } });
    });
    rerender();

    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore - 1);
  });

  it('online + Ask: a decline leaves the board untouched', async () => {
    pushConsentStep();
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    const raise = mockRaise();
    usePlayStore.setState({ raiseGameRequest: raise });

    const { result, rerender } = renderHook(() => useTakeback(seatedTable(0)));
    await act(async () => {
      result.current.attempt();
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    await act(async () => {
      usePlayStore.setState({ onlineRequests: { 0: request({ status: 'denied' }) } });
    });
    rerender();

    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore);
    expect(result.current.pendingRequest?.status).toBe('denied');
  });

  it('online + Ask: expiry leaves the board untouched', async () => {
    pushConsentStep();
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    const raise = mockRaise();
    usePlayStore.setState({ raiseGameRequest: raise });

    const { result, rerender } = renderHook(() => useTakeback(seatedTable(0)));
    await act(async () => {
      result.current.attempt();
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    await act(async () => {
      usePlayStore.setState({ onlineRequests: { 0: request({ status: 'expired' }) } });
    });
    rerender();

    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore);
  });

  it('online + Free mode: a consent step applies immediately without asking', () => {
    pushConsentStep();
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    usePlaytestStore.setState({ takebackMode: 'free' });
    const raise = usePlayStore.getState().raiseGameRequest;

    const { result } = renderHook(() => useTakeback(seatedTable(0)));
    expect(result.current.plan).toBe('apply');
    act(() => {
      result.current.attempt();
    });
    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore - 1);
    expect(raise).not.toHaveBeenCalled();
  });

  it('cancelPending withdraws this seat’s own request', async () => {
    pushConsentStep();
    const raise = mockRaise();
    const cancel = vi.fn().mockResolvedValue(request({ status: 'cancelled' }));
    usePlayStore.setState({ raiseGameRequest: raise, cancelGameRequest: cancel });

    const { result, rerender } = renderHook(() => useTakeback(seatedTable(0)));
    await act(async () => {
      result.current.attempt();
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();
    expect(result.current.pendingRequest).not.toBeNull();

    act(() => {
      result.current.cancelPending();
    });
    rerender();

    expect(cancel).toHaveBeenCalledWith('req1');
    expect(result.current.pendingRequest).toBeNull();
  });

  it('an approval that arrives after the requester takes another action does NOT undo, and surfaces the changed outcome', async () => {
    vi.useFakeTimers();
    pushConsentStep();
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    const raise = mockRaise();
    usePlayStore.setState({ raiseGameRequest: raise });

    const { result, rerender } = renderHook(() => useTakeback(seatedTable(0)));
    await act(async () => {
      result.current.attempt();
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();
    expect(result.current.pendingRequest?.status).toBe('pending');

    // The requester is not blocked from acting while the ask is outstanding
    // — they draw a card (a locked step) before the table responds.
    pushLockedStep();
    rerender();

    await act(async () => {
      usePlayStore.setState({ onlineRequests: { 0: request({ status: 'approved' }) } });
    });
    rerender();

    // Nothing was undone — applying the approval now would take back the
    // draw instead of the action the table actually approved.
    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore + 1);
    expect(result.current.pendingRequest?.status).toBe('approved');
    expect(result.current.pendingOutcomeMessage).toMatch(/board changed/i);

    // And it clears back to idle after the usual resolution beat.
    act(() => {
      vi.advanceTimersByTime(4001);
    });
    rerender();
    expect(result.current.pendingRequest).toBeNull();
    expect(result.current.pendingOutcomeMessage).toBeNull();
  });

  it('the changed-outcome banner still clears when the requester keeps playing during the display beat', async () => {
    vi.useFakeTimers();
    pushConsentStep();
    const raise = mockRaise();
    usePlayStore.setState({ raiseGameRequest: raise });

    const { result, rerender } = renderHook(() => useTakeback(seatedTable(0)));
    await act(async () => {
      result.current.attempt();
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    pushLockedStep();
    rerender();
    await act(async () => {
      usePlayStore.setState({ onlineRequests: { 0: request({ status: 'approved' }) } });
    });
    rerender();
    expect(result.current.pendingOutcomeMessage).toMatch(/board changed/i);

    // The user keeps playing mid-beat — the clear timer must survive the
    // rewindTrail change (a timer owned by the trail-dependent effect gets
    // cancelled by that effect's own cleanup here, and the applied-once
    // guard then blocks rescheduling it, sticking the banner forever).
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    pushFreeStep();
    rerender();
    act(() => {
      vi.advanceTimersByTime(2001);
    });
    rerender();
    expect(result.current.pendingRequest).toBeNull();
    expect(result.current.pendingOutcomeMessage).toBeNull();
  });

  it('an approval still applies when the requester took a free action and undid it themselves while waiting', async () => {
    pushConsentStep();
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    const raise = mockRaise();
    usePlayStore.setState({ raiseGameRequest: raise });

    const { result, rerender } = renderHook(() => useTakeback(seatedTable(0)));
    await act(async () => {
      result.current.attempt();
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();

    pushFreeStep();
    act(() => {
      usePlaytestStore.getState().dispatch({ type: 'UNDO' });
    });
    rerender();

    // Back to the same trail head that was captured when the request was
    // raised — the approval should still apply.
    await act(async () => {
      usePlayStore.setState({ onlineRequests: { 0: request({ status: 'approved' }) } });
    });
    rerender();

    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore - 1);
    expect(result.current.pendingOutcomeMessage).toBeNull();
  });

  it('a requester whose terminal frame was lost flips to expired locally at expiresAt, then clears', async () => {
    vi.useFakeTimers();
    pushConsentStep();
    const pastBefore = usePlaytestStore.getState().state!.past.length;
    const now = Date.now();
    const raise = mockRaise(request({ expiresAt: now + 1000 }));
    usePlayStore.setState({ raiseGameRequest: raise });

    const { result, rerender } = renderHook(() => useTakeback(seatedTable(0)));
    await act(async () => {
      result.current.attempt();
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender();
    expect(result.current.pendingRequest?.status).toBe('pending');

    // Past the deadline plus the local grace window — no server frame ever
    // arrived, so the requester's own banner must flip on its own.
    act(() => {
      vi.advanceTimersByTime(1000 + 2000 + 1);
    });
    rerender();
    expect(result.current.pendingRequest?.status).toBe('expired');
    expect(usePlaytestStore.getState().state!.past.length).toBe(pastBefore); // never applied

    act(() => {
      vi.advanceTimersByTime(4001);
    });
    rerender();
    expect(result.current.pendingRequest).toBeNull();
  });
});
