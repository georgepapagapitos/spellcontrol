// @vitest-environment happy-dom
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { usePullToRefresh, PTR_THRESHOLD } from './use-pull-to-refresh';

function touch(type: string, clientY: number): Event {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  Object.defineProperty(ev, 'touches', { value: [{ clientY }] });
  return ev;
}

function makeScrollEl(scrollTop = 0): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true });
  document.body.appendChild(el);
  return el;
}

describe('usePullToRefresh', () => {
  it('arms past the threshold and refreshes on release', async () => {
    const el = makeScrollEl(0);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(el, onRefresh));

    act(() => el.dispatchEvent(touch('touchstart', 0)));
    act(() => el.dispatchEvent(touch('touchmove', 200))); // big downward drag
    expect(result.current.status).toBe('armed');
    expect(result.current.pull).toBeGreaterThanOrEqual(PTR_THRESHOLD);

    act(() => el.dispatchEvent(touch('touchend', 200)));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('refreshing');

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.pull).toBe(0);
  });

  it('does not refresh a short drag below the threshold', () => {
    const el = makeScrollEl(0);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(el, onRefresh));

    act(() => el.dispatchEvent(touch('touchstart', 0)));
    act(() => el.dispatchEvent(touch('touchmove', 40))); // 40 * 0.5 = 20px < threshold
    expect(result.current.status).toBe('pulling');

    act(() => el.dispatchEvent(touch('touchend', 40)));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.pull).toBe(0);
  });

  it('ignores the gesture when the list is not scrolled to the top', () => {
    const el = makeScrollEl(120); // mid-scroll
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePullToRefresh(el, onRefresh));

    act(() => el.dispatchEvent(touch('touchstart', 0)));
    act(() => el.dispatchEvent(touch('touchmove', 200)));
    expect(result.current.status).toBe('idle');
    expect(result.current.pull).toBe(0);
    act(() => el.dispatchEvent(touch('touchend', 200)));
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
