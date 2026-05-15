// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHolographic } from './use-holographic';

function makeEl(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

let rafCallbacks: FrameRequestCallback[] = [];
beforeEach(() => {
  rafCallbacks = [];
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  // Default: hover-capable env — (hover: hover) returns true
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
    media: '(hover: hover)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
});

function flushRaf(times = 5) {
  for (let i = 0; i < times; i++) {
    const queue = rafCallbacks.splice(0);
    for (const cb of queue) cb(performance.now());
    if (rafCallbacks.length === 0) break;
  }
}

describe('useHolographic', () => {
  it('returns a callback ref that does nothing when disabled', () => {
    const { result } = renderHook(() => useHolographic(false));
    const el = makeEl();
    act(() => result.current(el));
    el.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50 }));
    expect(el.style.getPropertyValue('--rx')).toBe('');
  });

  it('attaches mouse listeners and updates CSS variables', () => {
    const { result } = renderHook(() => useHolographic(true));
    const el = makeEl();
    act(() => result.current(el));
    act(() => {
      el.dispatchEvent(new MouseEvent('mousemove', { clientX: 75, clientY: 25 }));
      flushRaf();
    });
    expect(el.style.getPropertyValue('--rx')).not.toBe('');
    expect(el.style.getPropertyValue('--mx')).not.toBe('');
    expect(el.style.getPropertyValue('--active')).not.toBe('');
  });

  it('eases back to neutral on mouseleave', () => {
    const { result } = renderHook(() => useHolographic(true));
    const el = makeEl();
    act(() => result.current(el));
    act(() => {
      el.dispatchEvent(new MouseEvent('mousemove', { clientX: 75, clientY: 25 }));
      flushRaf();
      el.dispatchEvent(new MouseEvent('mouseleave'));
      flushRaf(50);
    });
    // Should not throw and the value should be a finite number
    const val = parseFloat(el.style.getPropertyValue('--rx'));
    expect(Number.isFinite(val)).toBe(true);
  });

  it('clears CSS variables on unmount', () => {
    const { result, unmount } = renderHook(() => useHolographic(true));
    const el = makeEl();
    act(() => result.current(el));
    act(() => {
      el.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50 }));
      flushRaf();
    });
    unmount();
    expect(el.style.getPropertyValue('--rx')).toBe('');
    expect(el.style.getPropertyValue('--mx')).toBe('');
  });

  it('skips tilt on touch-only devices', () => {
    // (hover: hover) returns false on touch-only devices
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(hover: hover)',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    const { result } = renderHook(() => useHolographic(true));
    const el = makeEl();
    act(() => result.current(el));
    // Mouse events should have no effect — no listeners attached.
    act(() => {
      el.dispatchEvent(new MouseEvent('mousemove', { clientX: 75, clientY: 25 }));
      flushRaf();
    });
    expect(el.style.getPropertyValue('--active')).toBe('');
  });

  it('suppresses tilt while shouldSuppressTilt returns true', () => {
    let suppress = true;
    const { result } = renderHook(() =>
      useHolographic(true, { shouldSuppressTilt: () => suppress })
    );
    const el = makeEl();
    act(() => result.current(el));
    act(() => {
      el.dispatchEvent(new MouseEvent('mousemove', { clientX: 100, clientY: 0 }));
      flushRaf();
    });
    // With suppress=true, --rx and --ry should remain ~0 even though --mx changes.
    expect(parseFloat(el.style.getPropertyValue('--rx'))).toBeCloseTo(0, 1);
    expect(parseFloat(el.style.getPropertyValue('--ry'))).toBeCloseTo(0, 1);
    expect(el.style.getPropertyValue('--mx')).not.toBe('');
    suppress = false;
  });
});
