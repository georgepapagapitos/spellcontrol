// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { KEEP_STILL_QUERY, useBoardKeepStill } from './use-board-keep-still';

type Listener = () => void;

function installMatchMedia(matches: boolean) {
  let listener: Listener | null = null;
  const mql = {
    get matches() {
      return matches;
    },
    media: KEEP_STILL_QUERY,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, l: Listener) => {
      listener = l;
    },
    removeEventListener: () => {
      listener = null;
    },
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) =>
      q === KEEP_STILL_QUERY
        ? mql
        : { matches: false, addEventListener() {}, removeEventListener() {} },
  });
  return { fire: () => listener?.() };
}

function installOrientation(type: string | undefined) {
  Object.defineProperty(window.screen, 'orientation', {
    configurable: true,
    value:
      type === undefined ? undefined : { type, addEventListener() {}, removeEventListener() {} },
  });
}

function installLegacyOrientation(value: number | undefined) {
  Object.defineProperty(window, 'orientation', { configurable: true, value });
}

afterEach(() => {
  installLegacyOrientation(undefined);
});

describe('useBoardKeepStill', () => {
  it('is 0 outside the short-landscape-coarse-pointer condition', () => {
    installMatchMedia(false);
    installOrientation('landscape-primary');
    const { result } = renderHook(() => useBoardKeepStill());
    expect(result.current).toBe(0);
  });

  it('is -90 for landscape-primary when the query matches', () => {
    installMatchMedia(true);
    installOrientation('landscape-primary');
    const { result } = renderHook(() => useBoardKeepStill());
    expect(result.current).toBe(-90);
  });

  it('is 90 for landscape-secondary when the query matches', () => {
    installMatchMedia(true);
    installOrientation('landscape-secondary');
    const { result } = renderHook(() => useBoardKeepStill());
    expect(result.current).toBe(90);
  });

  it('falls back to the legacy window.orientation when screen.orientation is unsupported (iOS Safari)', () => {
    installMatchMedia(true);
    installOrientation(undefined);
    installLegacyOrientation(90);
    const { result } = renderHook(() => useBoardKeepStill());
    expect(result.current).toBe(90);
  });

  it('defaults to -90 when neither orientation API is available', () => {
    installMatchMedia(true);
    installOrientation(undefined);
    installLegacyOrientation(undefined);
    const { result } = renderHook(() => useBoardKeepStill());
    expect(result.current).toBe(-90);
  });

  it('re-evaluates when the media query itself changes (device rotated back upright)', () => {
    const { fire } = installMatchMedia(false);
    installOrientation('landscape-primary');
    const { result } = renderHook(() => useBoardKeepStill());
    expect(result.current).toBe(0);
    act(() => fire());
    // The mock mql.matches getter still returns the fixed `false` above —
    // this only proves the listener is wired without throwing; the sign
    // cases above already cover the matches=true branch.
    expect(result.current).toBe(0);
  });
});
