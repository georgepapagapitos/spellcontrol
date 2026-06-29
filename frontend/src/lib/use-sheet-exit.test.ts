// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSheetExit } from './use-sheet-exit';

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

afterEach(() => vi.restoreAllMocks());

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
});
