// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeckHoverPeek } from './use-deck-hover-peek';

// The hook is capability-gated to a fine+hover pointer and a min viewport; mock
// both so onMouseOver actually runs (touch/native otherwise no-op it).
function mockCapable() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(window, 'innerWidth', { writable: true, value: 1400 });
  Object.defineProperty(window, 'innerHeight', { writable: true, value: 900 });
}

function peekEl(attrs: Record<string, string>) {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fire(handler: (e: any) => void, target: HTMLElement) {
  act(() => handler({ target, clientX: 200, clientY: 100 }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fireOut(handler: (e: any) => void, target: HTMLElement, relatedTarget: Element | null) {
  act(() => handler({ target, relatedTarget }));
}

describe('useDeckHoverPeek — per-printing peek', () => {
  beforeEach(mockCapable);

  it('peeks each printing via data-peek-img and re-pins between same-named printings', () => {
    const { result } = renderHook(() => useDeckHoverPeek({ anchor: 'row' }));

    fire(
      result.current.listHandlers.onMouseOver,
      peekEl({ 'data-peek-name': 'Mountain', 'data-peek-img': 'imgA' })
    );
    expect(result.current.peek?.img).toBe('imgA');

    // Same name, different printing — must NOT dedupe away.
    fire(
      result.current.listHandlers.onMouseOver,
      peekEl({ 'data-peek-name': 'Mountain', 'data-peek-img': 'imgB' })
    );
    expect(result.current.peek?.img).toBe('imgB');
  });

  it('dedupes a repeat hover of the same printing (no churn)', () => {
    const { result } = renderHook(() => useDeckHoverPeek({ anchor: 'row' }));
    const el = peekEl({ 'data-peek-name': 'Mountain', 'data-peek-img': 'imgA' });

    fire(result.current.listHandlers.onMouseOver, el);
    const first = result.current.peek;
    fire(result.current.listHandlers.onMouseOver, el);
    expect(result.current.peek).toBe(first); // unchanged reference → setPeek skipped
  });

  it('clears when leaving a card row for non-card space', () => {
    const { result } = renderHook(() => useDeckHoverPeek({ anchor: 'row' }));
    const row = peekEl({ 'data-peek-name': 'Sol Ring' });
    const blank = document.createElement('div');

    fire(result.current.listHandlers.onMouseOver, row);
    expect(result.current.peek?.name).toBe('Sol Ring');

    fireOut(result.current.listHandlers.onMouseOut, row, blank);
    expect(result.current.peek).toBeNull();
  });

  it('keeps the peek while moving within a card row', () => {
    const { result } = renderHook(() => useDeckHoverPeek({ anchor: 'row' }));
    const row = peekEl({ 'data-peek-name': 'Sol Ring' });
    const child = document.createElement('span');
    row.appendChild(child);

    fire(result.current.listHandlers.onMouseOver, row);
    const first = result.current.peek;

    fireOut(result.current.listHandlers.onMouseOut, row, child);
    expect(result.current.peek).toBe(first);
  });
});
