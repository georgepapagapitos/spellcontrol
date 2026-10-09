// @vitest-environment happy-dom
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previousDay, type DailyResult } from '@/lib/daily/stats';

const auth = vi.hoisted(() => ({ status: 'authed' as 'unknown' | 'loading' | 'authed' | 'guest' }));
vi.mock('@/store/auth', () => ({
  useAuth: (sel: (s: typeof auth) => unknown) => sel(auth),
}));

const server = vi.hoisted(() => ({ fetch: vi.fn<() => Promise<DailyResult[]>>() }));
vi.mock('@/lib/daily/daily-client', () => ({
  fetchMyDailyResults: () => server.fetch(),
}));

import { useDailyStore } from '@/store/daily';
import { useDailyReminder } from './use-daily-reminder';

const today = new Date().toISOString().slice(0, 10);
const yesterday = previousDay(today);

beforeEach(() => {
  auth.status = 'authed';
  server.fetch.mockReset();
  useDailyStore.setState({ guesses: {}, results: [], unposted: [] });
});

describe('useDailyReminder', () => {
  it('is loading until auth settles', () => {
    auth.status = 'unknown';
    const { result } = renderHook(() => useDailyReminder());
    expect(result.current).toEqual({ loading: true, reminder: null });
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('reads a guest from this device only', () => {
    auth.status = 'guest';
    useDailyStore.setState({ guesses: { [today]: ['Opt', 'Shock'] } });
    const { result } = renderHook(() => useDailyReminder());
    expect(result.current).toEqual({ loading: false, reminder: { streak: 0, guessesUsed: 2 } });
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it("signed in, folds in the account's history before deciding", async () => {
    server.fetch.mockResolvedValue([{ date: yesterday, solved: true, guesses: 3 }]);
    const { result } = renderHook(() => useDailyReminder());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reminder).toEqual({ streak: 1, guessesUsed: 0 });
  });

  it('signed in, a card solved on another device clears the reminder', async () => {
    useDailyStore.setState({ results: [{ date: yesterday, solved: true, guesses: 3 }] });
    server.fetch.mockResolvedValue([{ date: today, solved: true, guesses: 4 }]);
    const { result } = renderHook(() => useDailyReminder());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reminder).toBeNull();
  });

  it("signed in, a failed read falls back to this device's results", async () => {
    useDailyStore.setState({ results: [{ date: yesterday, solved: true, guesses: 3 }] });
    server.fetch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useDailyReminder());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reminder).toEqual({ streak: 1, guessesUsed: 0 });
  });
});
