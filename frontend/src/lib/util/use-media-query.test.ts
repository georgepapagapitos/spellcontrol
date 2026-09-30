// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './use-media-query';

/** A controllable MediaQueryList stub — captures the 'change' listener so the
 * test can flip `matches` and fire it, mirroring how a real viewport resize
 * drives matchMedia's change event. */
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  let listener: (() => void) | null = null;
  const mql = {
    get matches() {
      return matches;
    },
    media: '',
    onchange: null,
    addEventListener: (_: string, fn: () => void) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    fireChange: (next: boolean) => {
      matches = next;
      listener?.();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('returns the current match on mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(true);
  });

  it('updates when the query starts matching', () => {
    const { fireChange } = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(false);
    act(() => fireChange(true));
    expect(result.current).toBe(true);
  });

  it('updates when the query stops matching', () => {
    const { fireChange } = stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(true);
    act(() => fireChange(false));
    expect(result.current).toBe(false);
  });
});
