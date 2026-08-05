// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSheetExit } from './use-sheet-exit';
import { useOverlayLayer } from './overlay-layer';

/** Stub window.matchMedia so the reduced-motion branch is controllable. */
function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

const fall = { animationName: 'sheet-fall' } as React.AnimationEvent;
const rise = { animationName: 'sheet-rise' } as React.AnimationEvent;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useSheetExit', () => {
  it('animates out: beginClose flips isClosing, onClose fires on sheet-fall end', () => {
    setReducedMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(onClose));

    expect(result.current.isClosing).toBe(false);

    act(() => result.current.beginClose());
    expect(result.current.isClosing).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    act(() => result.current.onAnimationEnd(fall));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores the on-mount rise animation end', () => {
    setReducedMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(onClose));

    // Rise ending before any close request must not unmount.
    act(() => result.current.onAnimationEnd(rise));
    expect(onClose).not.toHaveBeenCalled();

    // And the rise name is ignored even while closing.
    act(() => result.current.beginClose());
    act(() => result.current.onAnimationEnd(rise));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('double beginClose only closes once', () => {
    setReducedMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(onClose));

    act(() => {
      result.current.beginClose();
      result.current.beginClose();
    });
    act(() => result.current.onAnimationEnd(fall));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('honors a custom exit animation name', () => {
    setReducedMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(onClose, 'stats-drawer-slide-out'));

    act(() => result.current.beginClose());
    // The default bottom-sheet keyframe no longer unmounts…
    act(() => result.current.onAnimationEnd(fall));
    expect(onClose).not.toHaveBeenCalled();
    // …the surface's own exit keyframe does.
    act(() =>
      result.current.onAnimationEnd({
        animationName: 'stats-drawer-slide-out',
      } as React.AnimationEvent)
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('honors any accepted exit animation name', () => {
    setReducedMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(onClose, ['sheet-fall', 'modal-panel-out']));

    act(() => result.current.beginClose());
    act(() => result.current.onAnimationEnd({ animationName: 'fade-out' } as React.AnimationEvent));
    expect(onClose).not.toHaveBeenCalled();

    act(() =>
      result.current.onAnimationEnd({ animationName: 'modal-panel-out' } as React.AnimationEvent)
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('falls back to closing on a timeout if the CSS never plays the exit animation', () => {
    // Mirrors `.card-picker-sheet`'s desktop centered-modal, which sets
    // `animation: none` on `.is-closing` — animationend never fires there.
    vi.useFakeTimers();
    setReducedMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(onClose));

    act(() => result.current.beginClose());
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(599));
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a real onAnimationEnd cancels the fallback timer — no double-close', () => {
    vi.useFakeTimers();
    setReducedMotion(false);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(onClose));

    act(() => result.current.beginClose());
    act(() => result.current.onAnimationEnd(fall));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reduced motion closes immediately without animating', () => {
    setReducedMotion(true);
    const onClose = vi.fn();
    const { result } = renderHook(() => useSheetExit(onClose));

    act(() => result.current.beginClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.isClosing).toBe(false);

    // Guard still holds: a second request does not double-close.
    act(() => result.current.beginClose());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('focus trap (via use-focus-trap.ts, wired for every consumer)', () => {
    function sheetPanel(html: string): HTMLElement {
      const el = document.createElement('div');
      el.tabIndex = -1;
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.innerHTML = html;
      document.body.appendChild(el);
      return el;
    }

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('moves focus into the sheet on mount with no call-site ref needed', () => {
      sheetPanel('<button id="a">a</button><button id="b">b</button>');
      renderHook(() => useSheetExit(vi.fn()));
      expect(document.activeElement?.id).toBe('a');
    });

    it('traps Tab inside the sheet and restores focus to the trigger on unmount', () => {
      const trigger = document.createElement('button');
      trigger.id = 'trigger';
      document.body.appendChild(trigger);
      trigger.focus();

      const panel = sheetPanel('<button id="a">a</button><button id="b">b</button>');
      const { unmount } = renderHook(() => useSheetExit(vi.fn()));

      panel.querySelector<HTMLElement>('#b')!.focus();
      const e = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      document.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(document.activeElement?.id).toBe('a');

      panel.remove();
      unmount();
      expect(document.activeElement?.id).toBe('trigger');
    });

    it('yields the trap to a dialog stacked on top of it (e.g. a confirm Modal)', () => {
      const outer = sheetPanel('<button id="a">a</button><button id="b">b</button>');
      const outerHook = renderHook(() => useSheetExit(vi.fn()));
      // A second layer (confirm dialog opened from the sheet) registers on
      // the same shared overlay stack and becomes topmost.
      const innerHook = renderHook(() => useOverlayLayer());
      expect(innerHook.result.current.isTopmost()).toBe(true);

      outer.querySelector<HTMLElement>('#b')!.focus();
      const e = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      document.dispatchEvent(e);

      // The outer sheet's trap must not fight the topmost layer for Tab.
      expect(e.defaultPrevented).toBe(false);
      expect(document.activeElement?.id).toBe('b');

      innerHook.unmount();
      outerHook.unmount();
    });

    it('does nothing when no dialog is mounted', () => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();
      renderHook(() => useSheetExit(vi.fn()));
      expect(document.activeElement).toBe(trigger);
    });
  });
});
