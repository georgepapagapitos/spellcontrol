// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  // The hook defers `setIsDragging(true)` to requestAnimationFrame (off the
  // touchmove critical path). Run it synchronously so the drag-state flip is
  // observable within the same `act()` the gesture is driven in.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
import { renderHook, act } from '@testing-library/react';
import { useSwipeDownDismiss } from './use-swipe-down-dismiss';
import type React from 'react';

function touch(clientX: number, clientY: number) {
  return { clientX, clientY } as unknown as React.Touch;
}

function evt(touches: React.Touch[], changedTouches: React.Touch[] = touches): React.TouchEvent {
  return {
    touches,
    changedTouches,
  } as unknown as React.TouchEvent;
}

/** A real div so the hook's imperative `style.transform` writes are observable. */
function sheet() {
  return { current: document.createElement('div') };
}

describe('useSwipeDownDismiss', () => {
  it('ignores up-swipes', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(50, 200)]));
      result.current.touchHandlers.onTouchMove(evt([touch(50, 50)]));
      result.current.touchHandlers.onTouchEnd(evt([], [touch(50, 50)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
    // An up-swipe never commits a vertical lock, so the sheet is untouched.
    expect(sheetRef.current.style.transform).toBe('');
  });

  it('locks horizontal when the user drags sideways', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(50, 50)]));
      result.current.touchHandlers.onTouchMove(evt([touch(200, 55)]));
    });
    expect(result.current.axisLockRef.current).toBe('h');
    // A horizontal lock must not drag the sheet — that belongs to the carousel.
    expect(sheetRef.current.style.transform).toBe('');
    act(() => {
      result.current.touchHandlers.onTouchEnd(evt([], [touch(200, 55)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('writes the drag offset straight to the sheet element (no React state)', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(50, 0)]));
      result.current.touchHandlers.onTouchMove(evt([touch(50, 90)]));
    });
    expect(sheetRef.current.style.transform).toBe('translateY(90px)');
    // A further move updates the same node imperatively.
    act(() => {
      result.current.touchHandlers.onTouchMove(evt([touch(50, 140)]));
    });
    expect(sheetRef.current.style.transform).toBe('translateY(140px)');
  });

  it('dismisses on a long downward drag', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(50, 0)]));
      result.current.touchHandlers.onTouchMove(evt([touch(50, 200)]));
    });
    expect(result.current.axisLockRef.current).toBe('v');
    expect(result.current.isDragging).toBe(true);
    expect(sheetRef.current.style.transform).toBe('translateY(200px)');
    act(() => {
      result.current.touchHandlers.onTouchEnd(evt([], [touch(50, 200)]));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Dismiss hands the release offset to onDismiss for the exit keyframe.
    expect(onDismiss).toHaveBeenCalledWith(200);
  });

  it('does not strand isDragging when the gesture ends before the deferred frame', () => {
    // Queue the rAF callback instead of running it, simulating a tap that
    // commits a vertical lock then ends within the same frame.
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame = cb;
      return 0;
    });
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(50, 0)]));
      result.current.touchHandlers.onTouchMove(evt([touch(50, 200)]));
      result.current.touchHandlers.onTouchEnd(evt([], [touch(50, 200)]));
    });
    // The deferred flip now fires — but the lock was reset on touchEnd, so it
    // must be guarded out, leaving isDragging false (no stuck sheet).
    act(() => {
      frame?.(0);
    });
    expect(result.current.isDragging).toBe(false);
  });

  it('dismisses on a fast flick', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    act(() => {
      now = 0;
      result.current.touchHandlers.onTouchStart(evt([touch(0, 0)]));
      now = 50;
      result.current.touchHandlers.onTouchMove(evt([touch(0, 60)]));
      now = 60;
      result.current.touchHandlers.onTouchEnd(evt([], [touch(0, 80)]));
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('does not dismiss a small drag with a slow release', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    act(() => {
      now = 0;
      result.current.touchHandlers.onTouchStart(evt([touch(0, 0)]));
      now = 1000;
      result.current.touchHandlers.onTouchMove(evt([touch(0, 30)]));
      now = 2000;
      result.current.touchHandlers.onTouchEnd(evt([], [touch(0, 30)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('handles touchEnd without a prior touchStart', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    act(() => {
      result.current.touchHandlers.onTouchEnd(evt([], [touch(0, 0)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores multi-touch touchStart', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(0, 0), touch(50, 0)]));
      result.current.touchHandlers.onTouchEnd(evt([], [touch(0, 0)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('pins nested track scroll while locked vertical', () => {
    const onDismiss = vi.fn();
    const sheetRef = sheet();
    const track = document.createElement('div');
    track.scrollLeft = 42;
    const trackRef = { current: track };
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, sheetRef, trackRef }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(0, 0)]));
      result.current.touchHandlers.onTouchMove(evt([touch(5, 50)]));
      // External scroll change should be reverted on next move
      track.scrollLeft = 999;
      result.current.touchHandlers.onTouchMove(evt([touch(5, 80)]));
    });
    expect(track.scrollLeft).toBe(42);
  });
});
