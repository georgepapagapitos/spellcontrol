// @vitest-environment happy-dom
/**
 * The shared AI status is one module-level snapshot. It must follow the
 * session: a guest who signs in gets the doors, someone who signs out loses
 * them — without a reload, and without a stale in-flight answer landing on
 * the new identity.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchAiStatus = vi.fn();
vi.mock('./ai-review', () => ({
  fetchAiStatus: (...args: unknown[]) => fetchAiStatus(...args),
  setAiOptIn: vi.fn(),
}));

import { useAuth } from '../store/auth';
import { __resetAiStatus, resetAiStatus, useAiStatus } from './use-ai-status';

const STATUS = { optIn: true, used: 0, limit: 10 };

beforeEach(() => {
  __resetAiStatus();
  fetchAiStatus.mockReset();
  useAuth.setState({ status: 'guest', user: null });
});

describe('useAiStatus follows the session', () => {
  it('re-fetches when a guest signs in, so AI doors appear without a reload', async () => {
    fetchAiStatus.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAiStatus());
    await waitFor(() => expect(result.current).toBeNull());

    fetchAiStatus.mockResolvedValueOnce(STATUS);
    act(() => {
      useAuth.setState({
        status: 'authed',
        user: { id: 'u1', username: 'me', role: 'admin' } as never,
      });
    });
    await waitFor(() => expect(result.current).toEqual(STATUS));
    expect(fetchAiStatus).toHaveBeenCalledTimes(2);
  });

  it('drops to unavailable on sign-out instead of keeping doors that would 401', async () => {
    useAuth.setState({
      status: 'authed',
      user: { id: 'u1', username: 'me', role: 'admin' } as never,
    });
    fetchAiStatus.mockResolvedValueOnce(STATUS);
    const { result } = renderHook(() => useAiStatus());
    await waitFor(() => expect(result.current).toEqual(STATUS));

    fetchAiStatus.mockResolvedValueOnce(null);
    act(() => {
      useAuth.setState({ status: 'guest', user: null });
    });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('bootstrap resolving for the first time does not refetch', async () => {
    // Fresh modules: the identity watcher starts undecided only at import
    // time, exactly like a page load whose bootstrap hasn't answered yet.
    vi.resetModules();
    const auth = await import('../store/auth');
    const mod = await import('./use-ai-status');
    auth.useAuth.setState({ status: 'loading', user: null });
    fetchAiStatus.mockResolvedValue(STATUS);
    const { result } = renderHook(() => mod.useAiStatus());
    await waitFor(() => expect(result.current).toEqual(STATUS));

    act(() => {
      auth.useAuth.setState({
        status: 'authed',
        user: { id: 'u1', username: 'me', role: 'admin' } as never,
      });
    });
    expect(fetchAiStatus).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual(STATUS);
  });

  it('ignores an in-flight answer that belongs to the previous identity', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    fetchAiStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const { result } = renderHook(() => useAiStatus());
    expect(result.current).toBeUndefined();

    fetchAiStatus.mockResolvedValueOnce(null);
    act(() => resetAiStatus());
    await waitFor(() => expect(result.current).toBeNull());

    // The stale fetch finally answers with a status for the OLD identity.
    await act(async () => {
      resolveFirst(STATUS);
    });
    expect(result.current).toBeNull();
  });
});
