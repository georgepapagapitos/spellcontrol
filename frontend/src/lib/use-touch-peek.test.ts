// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTouchPeek } from './use-touch-peek';

afterEach(() => {
  vi.useRealTimers();
});

function peekEl(attrs: Record<string, string> = { 'data-peek-name': 'Sol Ring' }) {
  const el = document.createElement('li');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.getBoundingClientRect = () =>
    ({
      top: 100,
      left: 200,
      right: 260,
      bottom: 180,
      width: 60,
      height: 80,
      x: 200,
      y: 100,
    }) as DOMRect;
  return el;
}

/** A button nested inside a peek-name row — mirrors qty-edit/kebab-menu
 *  controls, which must never arm the long-press. */
function interactiveChildOf(row: HTMLElement) {
  const btn = document.createElement('button');
  row.appendChild(btn);
  return btn;
}

function touchStart(x = 0, y = 0, target: HTMLElement, touchCount = 1) {
  const touches = Array.from({ length: touchCount }, () => ({ clientX: x, clientY: y }));
  return { target, touches } as unknown as React.TouchEvent;
}

function touchMove(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as React.TouchEvent;
}

function touchEnd(preventDefault = vi.fn()) {
  return { preventDefault } as unknown as React.TouchEvent;
}

function clickEvent(preventDefault = vi.fn(), stopPropagation = vi.fn()) {
  return { preventDefault, stopPropagation } as unknown as React.MouseEvent;
}

describe('useTouchPeek', () => {
  it('opens the peek after a long-press on a [data-peek-name] element', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const el = peekEl({ 'data-peek-name': 'Sol Ring' });

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el)));
    expect(result.current.peek).toBeNull();

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek?.name).toBe('Sol Ring');
    expect(result.current.peek?.width).toBeGreaterThan(0);
  });

  it('resolves data-peek-img for a per-printing sub-row', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const el = peekEl({ 'data-peek-name': 'Mountain', 'data-peek-img': 'https://cdn/mtn.jpg' });

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el)));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek?.img).toBe('https://cdn/mtn.jpg');
  });

  it('never arms on an interactive descendant (qty/menu/remove controls untouched)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const row = peekEl();
    const btn = interactiveChildOf(row);

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, btn)));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek).toBeNull();
  });

  it('cancels a pending press on movement past the slop (scroll intent) — page scroll stays native', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const el = peekEl();

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el)));
    act(() => result.current.listHandlers.onTouchMove(touchMove(220, 100))); // 20px > 6px slop
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek).toBeNull();
  });

  it('dismisses an already-open peek on movement past the slop', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const el = peekEl();

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el)));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek).not.toBeNull();

    act(() => result.current.listHandlers.onTouchMove(touchMove(220, 100)));
    expect(result.current.peek).toBeNull();
  });

  it('a second touch dismisses the peek', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const el = peekEl();

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el)));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek).not.toBeNull();

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el, 2)));
    expect(result.current.peek).toBeNull();
  });

  it('release before the delay is a plain tap — no peek, and the resulting click is left alone', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const el = peekEl();

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el)));
    act(() => vi.advanceTimersByTime(200));
    const end = touchEnd();
    act(() => result.current.listHandlers.onTouchEnd(end));
    expect(result.current.peek).toBeNull();
    expect(end.preventDefault).not.toHaveBeenCalled();

    const click = clickEvent();
    act(() => result.current.listHandlers.onClickCapture(click));
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(click.stopPropagation).not.toHaveBeenCalled();
  });

  it('release after a fired long-press dismisses the peek, prevents the touchend default, and swallows the following click', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const el = peekEl();

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el)));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek).not.toBeNull();

    const end = touchEnd();
    act(() => result.current.listHandlers.onTouchEnd(end));
    expect(result.current.peek).toBeNull();
    expect(end.preventDefault).toHaveBeenCalledOnce();

    // The browser dispatches a click anyway (some browsers don't fully honor
    // touchend's preventDefault) — the delegated capture handler swallows it.
    const click = clickEvent();
    act(() => result.current.listHandlers.onClickCapture(click));
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopPropagation).toHaveBeenCalledOnce();
  });

  it('a fresh gesture is unaffected by a prior press whose click was never dispatched', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const first = peekEl({ 'data-peek-name': 'Sol Ring' });

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, first)));
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.listHandlers.onTouchEnd(touchEnd()));
    // No click ever arrives for the first gesture (fully suppressed) — `fired`
    // would leak into the next gesture without the reset at onTouchStart.

    const second = peekEl({ 'data-peek-name': 'Lightning Bolt' });
    act(() => result.current.listHandlers.onTouchStart(touchStart(50, 50, second)));
    act(() => result.current.listHandlers.onTouchEnd(touchEnd())); // plain tap, released early
    const click = clickEvent();
    act(() => result.current.listHandlers.onClickCapture(click));
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  it('clear() dismisses the peek imperatively (e.g. when the carousel opens instead)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTouchPeek());
    const el = peekEl();

    act(() => result.current.listHandlers.onTouchStart(touchStart(200, 100, el)));
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.peek).not.toBeNull();

    act(() => result.current.clear());
    expect(result.current.peek).toBeNull();
  });
});
