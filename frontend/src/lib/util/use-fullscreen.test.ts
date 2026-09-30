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

/** Install a mock `screen.orientation` with spy-able lock/unlock, or remove
 *  it entirely (`undefined`) to simulate an unsupported browser (iOS Safari). */
function installOrientation(
  impl: { lock?: ReturnType<typeof vi.fn>; unlock?: ReturnType<typeof vi.fn> } | undefined
) {
  Object.defineProperty(window.screen, 'orientation', {
    configurable: true,
    value: impl,
  });
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

  describe('portrait orientation lock', () => {
    // The lock rides fullscreen ownership — same gesture asks for both, same
    // release gives both back — so it uses the same ownership tracking
    // exitOnUnmount already relies on (confirmed by fullscreenchange, never
    // assumed the instant enter() is called).
    it('locks to portrait once this hook’s own enter() is confirmed by fullscreenchange', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      const lock = vi.fn().mockResolvedValue(undefined);
      installOrientation({ lock });
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFullscreen());

      act(() => result.current.enter());
      expect(lock).not.toHaveBeenCalled(); // not yet — enter() is async, unconfirmed

      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });
      expect(lock).toHaveBeenCalledTimes(1);
      expect(lock).toHaveBeenCalledWith('portrait');
    });

    it('does not lock orientation for a fullscreen entered some other way', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      const lock = vi.fn().mockResolvedValue(undefined);
      installOrientation({ lock });
      const { result: _unused } = renderHook(() => useFullscreen());
      void _unused;

      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });
      expect(lock).not.toHaveBeenCalled();
    });

    it('unlocks on a manual exit this hook owned, once fullscreenchange confirms it left', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      const unlock = vi.fn();
      installOrientation({ lock: vi.fn().mockResolvedValue(undefined), unlock });
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFullscreen());

      act(() => result.current.enter());
      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });
      act(() => result.current.exit());
      act(() => {
        installFullscreenElement(null);
        fireFullscreenChange();
      });
      expect(unlock).toHaveBeenCalledTimes(1);
    });

    it('does not unlock a fullscreen this hook never owned when it ends', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      const unlock = vi.fn();
      installOrientation({ lock: vi.fn().mockResolvedValue(undefined), unlock });
      renderHook(() => useFullscreen());

      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });
      act(() => {
        installFullscreenElement(null);
        fireFullscreenChange();
      });
      expect(unlock).not.toHaveBeenCalled();
    });

    it('unlocks directly on unmount (exitOnUnmount) rather than waiting for fullscreenchange', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      const unlock = vi.fn();
      installOrientation({ lock: vi.fn().mockResolvedValue(undefined), unlock });
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      const { result, unmount } = renderHook(() => useFullscreen({ exitOnUnmount: true }));

      act(() => result.current.enter());
      act(() => {
        installFullscreenElement(document.documentElement);
        fireFullscreenChange();
      });
      unmount();
      expect(unlock).toHaveBeenCalledTimes(1);
    });

    it('never throws when screen.orientation is unsupported (iOS Safari)', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      installOrientation(undefined);
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFullscreen());

      act(() => result.current.enter());
      expect(() =>
        act(() => {
          installFullscreenElement(document.documentElement);
          fireFullscreenChange();
        })
      ).not.toThrow();
    });

    it('never throws when lock() rejects', () => {
      installFullscreenEnabled(true);
      installMatchMedia(true);
      installOrientation({ lock: vi.fn().mockRejectedValue(new Error('nope')) });
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useFullscreen());

      act(() => result.current.enter());
      expect(() =>
        act(() => {
          installFullscreenElement(document.documentElement);
          fireFullscreenChange();
        })
      ).not.toThrow();
    });
  });
});
