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
    vi.restoreAllMocks();
  });

  it('polls with the code and the current getSince() value', async () => {
    mockPoll
      .mockImplementationOnce(async () => null)
      .mockImplementation(() => new Promise(() => {}));
    const since = 3;
    subscribeGameLongPoll('ABCD', () => since, { onState: vi.fn() });
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
    subscribeGameLongPoll('ABCD', () => 1, { onState, onHealthy });
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
    subscribeGameLongPoll('ABCD', () => 1, { onState, onHealthy });
    await flush();
    expect(onState).not.toHaveBeenCalled();
    expect(onHealthy).toHaveBeenCalledOnce();
  });

  it('loops again immediately after a successful round-trip', async () => {
    mockPoll
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => null)
      .mockImplementation(() => new Promise(() => {}));
    subscribeGameLongPoll('ABCD', () => 1, { onState: vi.fn() });
    await flush();
    await flush();
    expect(mockPoll.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('a failed round-trip calls onError and stops the loop', async () => {
    mockPoll.mockRejectedValueOnce(new Error('network'));
    const onError = vi.fn();
    const onHealthy = vi.fn();
    subscribeGameLongPoll('ABCD', () => 1, { onState: vi.fn(), onError, onHealthy });
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
    const teardown = subscribeGameLongPoll('ABCD', () => 1, { onState });
    await flush();
    teardown();
    resolveSecond(mockState(5));
    await flush();
    expect(onState).not.toHaveBeenCalled();
  });
});
