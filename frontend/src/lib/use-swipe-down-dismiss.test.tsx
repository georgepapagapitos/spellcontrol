// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
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

describe('useSwipeDownDismiss', () => {
  it('ignores up-swipes', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(50, 200)]));
      result.current.touchHandlers.onTouchMove(evt([touch(50, 50)]));
      result.current.touchHandlers.onTouchEnd(evt([], [touch(50, 50)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('locks horizontal when the user drags sideways', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(50, 50)]));
      result.current.touchHandlers.onTouchMove(evt([touch(200, 55)]));
    });
    expect(result.current.axisLockRef.current).toBe('h');
    act(() => {
      result.current.touchHandlers.onTouchEnd(evt([], [touch(200, 55)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on a long downward drag', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(50, 0)]));
      result.current.touchHandlers.onTouchMove(evt([touch(50, 200)]));
    });
    expect(result.current.axisLockRef.current).toBe('v');
    expect(result.current.dragY).toBeGreaterThan(0);
    act(() => {
      result.current.touchHandlers.onTouchEnd(evt([], [touch(50, 200)]));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a fast flick', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss }));
    const start = performance.now;
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
    void start;
  });

  it('does not dismiss a small drag with a slow release', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss }));
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
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss }));
    act(() => {
      result.current.touchHandlers.onTouchEnd(evt([], [touch(0, 0)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores multi-touch touchStart', () => {
    const onDismiss = vi.fn();
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss }));
    act(() => {
      result.current.touchHandlers.onTouchStart(evt([touch(0, 0), touch(50, 0)]));
      result.current.touchHandlers.onTouchEnd(evt([], [touch(0, 0)]));
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('pins nested track scroll while locked vertical', () => {
    const onDismiss = vi.fn();
    const track = document.createElement('div');
    track.scrollLeft = 42;
    const trackRef = { current: track };
    const { result } = renderHook(() => useSwipeDownDismiss({ onDismiss, trackRef }));
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
