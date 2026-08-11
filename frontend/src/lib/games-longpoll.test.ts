import { describe, it, expect, vi, afterEach } from 'vitest';
import { subscribeGameLongPoll, usesLongPoll } from './games-longpoll';
import type { GameState } from './game-state';

// The loop's single round-trip is games-api's pollGame; mock it directly so
// these tests exercise the loop/backoff logic without a real fetch.
vi.mock('./games-api', () => ({ pollGame: vi.fn() }));
import { pollGame } from './games-api';

const mockPoll = vi.mocked(pollGame);

function mockState(version: number): GameState {
  return { code: 'ABCD', version } as unknown as GameState;
}

/** Let all pending microtasks (including chained ones inside the loop) drain. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('usesLongPoll', () => {
  it('is false for an empty (web/same-origin) API base', () => {
    expect(usesLongPoll('')).toBe(false);
  });

  it('is true for a non-empty (native/cross-origin) API base', () => {
    expect(usesLongPoll('https://spellcontrol.com')).toBe(true);
  });
});

describe('subscribeGameLongPoll', () => {
  afterEach(() => {
    // Tear down any loop a test left running, so its calls can't land in the
    // next test's counts.
    for (const stop of running.splice(0)) stop();
    vi.useRealTimers();
    // `restoreAllMocks` restores implementations but does NOT clear
    // `mock.calls`, so without this the counts accumulate across tests and a
    // `toHaveBeenCalledTimes` assertion reads the whole file's history.
    mockPoll.mockReset();
    vi.restoreAllMocks();
  });

  /** Loops started by a test, torn down in afterEach. */
  const running: Array<() => void> = [];
  function startLoop(...args: Parameters<typeof subscribeGameLongPoll>): () => void {
    const stop = subscribeGameLongPoll(...args);
    running.push(stop);
    return stop;
  }

  it('polls with the code and the current getSince() value', async () => {
    mockPoll
      .mockImplementationOnce(async () => null)
      .mockImplementation(() => new Promise(() => {}));
    const since = 3;
    startLoop('ABCD', () => since, { onState: vi.fn() });
    await flush();
    expect(mockPoll.mock.calls[0][0]).toBe('ABCD');
    expect(mockPoll.mock.calls[0][1]).toBe(3);
  });

  it('forwards a fresh state to onState and reports healthy', async () => {
    const state = mockState(9);
    mockPoll
      .mockImplementationOnce(async () => state)
      .mockImplementation(() => new Promise(() => {}));
    const onState = vi.fn();
    const onHealthy = vi.fn();
    startLoop('ABCD', () => 1, { onState, onHealthy });
    await flush();
    expect(onState).toHaveBeenCalledWith(state);
    expect(onHealthy).toHaveBeenCalledOnce();
  });

  it('an unchanged round-trip (null) still reports healthy without calling onState', async () => {
    mockPoll
      .mockImplementationOnce(async () => null)
      .mockImplementation(() => new Promise(() => {}));
    const onState = vi.fn();
    const onHealthy = vi.fn();
    startLoop('ABCD', () => 1, { onState, onHealthy });
    await flush();
    expect(onState).not.toHaveBeenCalled();
    expect(onHealthy).toHaveBeenCalledOnce();
  });

  it('loops again after a successful round-trip', async () => {
    mockPoll
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => null)
      .mockImplementation(() => new Promise(() => {}));
    startLoop('ABCD', () => 1, { onState: vi.fn() });
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await flush();
    expect(mockPoll.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  // Regression guard: the server answers /poll IMMEDIATELY whenever its version
  // is ahead of `since`, and `since` stops advancing while the caller is
  // mid-flush (store/play.ts skips adoption during an in-flight PATCH). Rapid
  // life-tapping holds that window open for a whole burst, so an unfloored loop
  // re-issues instantly and burst-hammers the backend into the 200/min limiter.
  it('floors the cycle time so an always-immediate server cannot hot-loop', async () => {
    vi.useFakeTimers();
    // Every round-trip resolves at once — the pathological case.
    mockPoll.mockImplementation(async () => null);
    startLoop('ABCD', () => 1, { onState: vi.fn() });

    await vi.advanceTimersByTimeAsync(0);
    expect(mockPoll).toHaveBeenCalledTimes(1);

    // Still just the one call before the floor elapses.
    await vi.advanceTimersByTimeAsync(200);
    expect(mockPoll).toHaveBeenCalledTimes(1);

    // The next call lands only once the floor passes.
    await vi.advanceTimersByTimeAsync(60);
    expect(mockPoll).toHaveBeenCalledTimes(2);

    // Over a full second the loop stays bounded (~4/s), not unbounded.
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockPoll.mock.calls.length).toBeLessThanOrEqual(7);
    vi.useRealTimers();
  });

  it('a failed round-trip calls onError and stops the loop', async () => {
    mockPoll.mockRejectedValueOnce(new Error('network'));
    const onError = vi.fn();
    const onHealthy = vi.fn();
    startLoop('ABCD', () => 1, { onState: vi.fn(), onError, onHealthy });
    await flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(onHealthy).not.toHaveBeenCalled();
    const callsAfterError = mockPoll.mock.calls.length;
    await flush();
    // No further calls once the loop has stopped on error.
    expect(mockPoll.mock.calls.length).toBe(callsAfterError);
  });

  it('the returned teardown aborts and stops further callbacks', async () => {
    let resolveSecond!: (v: GameState | null) => void;
    mockPoll
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          })
      );
    const onState = vi.fn();
    vi.useFakeTimers();
    const teardown = startLoop('ABCD', () => 1, { onState });
    // The first round-trip resolves, then the loop waits out the cycle floor
    // before issuing the second — advance past it so `resolveSecond` is bound.
    await vi.advanceTimersByTimeAsync(300);
    teardown();
    resolveSecond(mockState(5));
    await vi.advanceTimersByTimeAsync(0);
    expect(onState).not.toHaveBeenCalled();
  });
});
