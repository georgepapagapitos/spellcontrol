// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullscreen } from './use-fullscreen';

type Listener = (e: MediaQueryListEvent) => void;

function installMatchMedia(matches: boolean) {
  const mql = {
    get matches() {
      return matches;
    },
    media: '(pointer: coarse)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, _l: Listener) => {},
    removeEventListener: (_: string, _l: Listener) => {},
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => mql,
  });
}

function installFullscreenEnabled(enabled: boolean) {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: enabled });
}

function installFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: el });
}

/** Simulate the browser confirming a fullscreen transition. */
function fireFullscreenChange() {
  document.dispatchEvent(new Event('fullscreenchange'));
}

afterEach(() => {
  vi.restoreAllMocks();
  installFullscreenElement(null);
});

describe('useFullscreen', () => {
  it('is unsupported on a fine-pointer device even when the API exists', () => {
    installFullscreenEnabled(true);
    installMatchMedia(false);
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.supported).toBe(false);
  });

  it('is unsupported when the Fullscreen API is unavailable, even on a coarse pointer', () => {
    installFullscreenEnabled(false);
    installMatchMedia(true);
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.supported).toBe(false);
  });

  it('is supported on a coarse-pointer device with the API present', () => {
    installFullscreenEnabled(true);
    installMatchMedia(true);
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.supported).toBe(true);
  });

  it('requests fullscreen on enter when supported', () => {
    installFullscreenEnabled(true);
    installMatchMedia(true);
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFullscreen());
    act(() => result.current.enter());
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('never throws and never requests fullscreen when unsupported', () => {
    installFullscreenEnabled(false);
    installMatchMedia(false);
    document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFullscreen());
    expect(() => act(() => result.current.enter())).not.toThrow();
    expect(document.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it('exits fullscreen when one is active', () => {
    installFullscreenEnabled(true);
    installMatchMedia(true);
    installFullscreenElement(document.documentElement);
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFullscreen());
    act(() => result.current.exit());
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('does nothing on exit when nothing is fullscreen', () => {
    installFullscreenEnabled(true);
    installMatchMedia(true);
    document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useFullscreen());
    act(() => result.current.exit());
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });

  describe('exitOnUnmount', () => {
    it('exits fullscreen on unmount when this hook is the one that entered it', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      const { result, unmount } = renderHook(() => useFullscreen({ exitOnUnmount: true }));

      act(() => result.current.enter());
      // The browser confirms the transition asynchronously — ownership is
      // only real once `fullscreenchange` says so, not the moment `enter()`
      // is called.
      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });

      unmount();
      expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    });

    it('does not exit a fullscreen entered some other way', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      const { unmount } = renderHook(() => useFullscreen({ exitOnUnmount: true }));

      // Fullscreen shows up without this hook's `enter()` ever being called —
      // some other feature, or the user's own F11/pinch gesture.
      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });

      unmount();
      expect(document.exitFullscreen).not.toHaveBeenCalled();
    });

    it('does not exit on unmount when the option is left off, even if this hook entered it', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      const { result, unmount } = renderHook(() => useFullscreen());

      act(() => result.current.enter());
      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });

      unmount();
      expect(document.exitFullscreen).not.toHaveBeenCalled();
    });

    it('stays quiet on unmount once fullscreen has already ended for any reason', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      const { result, unmount } = renderHook(() => useFullscreen({ exitOnUnmount: true }));

      act(() => result.current.enter());
      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });
      // Exits before the board ever unmounts (Escape, the menu's own toggle,
      // another feature) — nothing left that's "ours" to give back.
      act(() => {
        installFullscreenElement(null);
        fireFullscreenChange();
      });

      unmount();
      expect(document.exitFullscreen).not.toHaveBeenCalled();
    });
  });
});
