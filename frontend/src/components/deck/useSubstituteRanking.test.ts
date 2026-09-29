// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ready: false, listeners: new Set<() => void>() }));
const prepare = vi.hoisted(() => vi.fn());

vi.mock('@/deck-builder/services/substitutes', () => ({
  substituteRankingReady: () => state.ready,
  subscribeSubstituteRanking: (fn: () => void) => {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  },
  prepareSubstituteRanking: prepare,
}));

import { useSubstituteRanking } from './useSubstituteRanking';

beforeEach(() => {
  state.ready = false;
  prepare.mockReset().mockResolvedValue(true);
});
afterEach(() => state.listeners.clear());

describe('useSubstituteRanking', () => {
  it('loads nothing until a surface asks', () => {
    const { result } = renderHook(() => useSubstituteRanking(false));
    expect(result.current).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('starts the load when asked and re-renders once the facts land', async () => {
    const { result } = renderHook(() => useSubstituteRanking(true));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
    act(() => {
      state.ready = true;
      for (const fn of state.listeners) fn();
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('never re-fetches once ready', () => {
    state.ready = true;
    const { result } = renderHook(() => useSubstituteRanking(true));
    expect(result.current).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
  });
});
