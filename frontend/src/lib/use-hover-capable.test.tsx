// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  HOVER_CAPABLE_QUERY,
  __resetHoverCapableForTests,
  useHoverCapable,
} from './use-hover-capable';

// Minimal controllable MediaQueryList: lets a test set `matches` and fire a
// change so we can assert the hook re-renders live.
function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const mqlState = {
    matches: initial,
    media: HOVER_CAPABLE_QUERY,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe(HOVER_CAPABLE_QUERY);
    return mqlState as unknown as MediaQueryList;
  });
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
  return {
    matchMedia,
    set(next: boolean) {
      mqlState.matches = next;
      listeners.forEach((cb) => cb());
    },
    listenerCount: () => listeners.size,
  };
}

describe('useHoverCapable', () => {
  afterEach(() => {
    __resetHoverCapableForTests();
    vi.restoreAllMocks();
  });

  it('reflects the initial match state', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useHoverCapable());
    expect(result.current).toBe(true);
  });

  it('returns false when not hover-capable', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useHoverCapable());
    expect(result.current).toBe(false);
  });

  it('re-renders live when capability flips (mouse plugged in)', () => {
    const ctl = stubMatchMedia(false);
    const { result } = renderHook(() => useHoverCapable());
    expect(result.current).toBe(false);
    act(() => ctl.set(true));
    expect(result.current).toBe(true);
  });

  it('shares a single MediaQueryList across many consumers', () => {
    const ctl = stubMatchMedia(true);
    renderHook(() => useHoverCapable());
    renderHook(() => useHoverCapable());
    renderHook(() => useHoverCapable());
    // One MQL object created and reused; each consumer attaches its own listener.
    expect(ctl.matchMedia).toHaveBeenCalledTimes(1);
    expect(ctl.listenerCount()).toBe(3);
  });

  it('unsubscribes its listener on unmount', () => {
    const ctl = stubMatchMedia(true);
    const { unmount } = renderHook(() => useHoverCapable());
    expect(ctl.listenerCount()).toBe(1);
    unmount();
    expect(ctl.listenerCount()).toBe(0);
  });
});
