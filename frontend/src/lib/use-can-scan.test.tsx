// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Stub isNativePlatform — scanner v2 is native-only, so we need to be able
// to flip this independently of the other capability gates. Default to
// `true` (native) so the existing "capable device" tests still measure the
// other gates instead of being trivially false.
vi.mock('./platform', () => ({ isNativePlatform: vi.fn(() => true) }));

import { useCanScan } from './use-can-scan';
import { isNativePlatform } from './platform';

type Listener = (e: MediaQueryListEvent) => void;

function installMatchMedia(matches: boolean): { setMatches: (m: boolean) => void } {
  const listeners = new Set<Listener>();
  let current = matches;
  const mql = {
    get matches() {
      return current;
    },
    media: '(pointer: coarse), (max-width: 1024px)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql,
  });
  return {
    setMatches(m) {
      current = m;
      for (const l of listeners) l({ matches: m } as MediaQueryListEvent);
    },
  };
}

function installGetUserMedia(present: boolean) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: present ? { getUserMedia: () => Promise.resolve(new MediaStream()) } : undefined,
  });
}

beforeEach(() => {
  installGetUserMedia(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCanScan', () => {
  it('returns true when the media query matches and getUserMedia exists', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useCanScan());
    expect(result.current).toBe(true);
  });

  it('returns false when the media query does not match (desktop)', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useCanScan());
    expect(result.current).toBe(false);
  });

  it('returns false when getUserMedia is unavailable even on coarse-pointer devices', () => {
    installMatchMedia(true);
    installGetUserMedia(false);
    const { result } = renderHook(() => useCanScan());
    expect(result.current).toBe(false);
  });

  it('returns false on web (non-native platform) even when device is capable', () => {
    installMatchMedia(true);
    installGetUserMedia(true);
    vi.mocked(isNativePlatform).mockReturnValueOnce(false);
    const { result } = renderHook(() => useCanScan());
    expect(result.current).toBe(false);
  });

  it('updates when the media query changes (e.g. window resize)', () => {
    const ctl = installMatchMedia(false);
    const { result } = renderHook(() => useCanScan());
    expect(result.current).toBe(false);

    act(() => ctl.setMatches(true));
    expect(result.current).toBe(true);

    act(() => ctl.setMatches(false));
    expect(result.current).toBe(false);
  });
});
