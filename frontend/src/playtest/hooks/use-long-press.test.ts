// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLongPress } from './use-long-press';

afterEach(() => {
  vi.useRealTimers();
});

/** Minimal single-touch event stub for the hook's touch handlers. */
function touch(x = 0, y = 0): React.TouchEvent {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as React.TouchEvent;
}

describe('useLongPress', () => {
  it('fires onLongPress after the delay when still mounted', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ delayMs: 500, onLongPress }));
    result.current.onTouchStart(touch());
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledOnce();
  });

  it('does not fire onLongPress if the element unmounts mid-press (F22)', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { result, unmount } = renderHook(() => useLongPress({ delayMs: 500, onLongPress }));
    result.current.onTouchStart(touch());
    unmount();
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
