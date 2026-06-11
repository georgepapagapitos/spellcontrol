// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Toast } from '../store/toasts';
import { applyRestackGlide, computeDepartures, useToastExits } from './use-toast-exits';

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

function makeToast(id: string, overrides: Partial<Toast> = {}): Toast {
  return {
    id,
    message: `msg-${id}`,
    tone: 'info',
    durationMs: 5000,
    createdAt: 0,
    ...overrides,
  };
}

function fakeRect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
  } as DOMRect;
}

function renderExits(initial: Toast[]) {
  return renderHook(({ toasts }: { toasts: Toast[] }) => useToastExits(toasts), {
    initialProps: { toasts: initial },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('computeDepartures', () => {
  it('returns toasts present before but missing now', () => {
    const a = makeToast('a');
    const b = makeToast('b');
    expect(computeDepartures([a, b], [a])).toEqual([b]);
  });

  it('returns nothing for identical or empty lists', () => {
    const a = makeToast('a');
    expect(computeDepartures([], [a])).toEqual([]);
    const same = [a];
    expect(computeDepartures(same, same)).toEqual([]);
  });
});

describe('applyRestackGlide', () => {
  it('commits the inverted offset before releasing into the transition', () => {
    const el = document.createElement('li');
    let atReflow = '';
    Object.defineProperty(el, 'offsetHeight', {
      configurable: true,
      get() {
        // Captured at the forced style flush — the inverted start point.
        atReflow = `${el.style.transition}|${el.style.transform}`;
        return 0;
      },
    });

    applyRestackGlide(el, -40);
    expect(atReflow).toBe('none|translateY(-40px)');
    // Released: inline styles cleared so the .toast class transition glides.
    expect(el.style.transform).toBe('');
    expect(el.style.transition).toBe('');
  });

  it('is a no-op for a zero delta', () => {
    const el = document.createElement('li');
    el.style.transform = 'translateY(1px)';
    applyRestackGlide(el, 0);
    expect(el.style.transform).toBe('translateY(1px)');
  });
});

describe('useToastExits', () => {
  it('mirrors the store list when nothing departs', () => {
    setReducedMotion(false);
    const a = makeToast('a');
    const b = makeToast('b');
    const { result } = renderExits([a, b]);

    expect(result.current.entries).toEqual([
      { toast: a, leaving: false },
      { toast: b, leaving: false },
    ]);
  });

  it('keeps a departed toast as a leaving entry until onExitEnd', () => {
    setReducedMotion(false);
    const a = makeToast('a');
    const b = makeToast('b');
    const { result, rerender } = renderExits([a, b]);

    rerender({ toasts: [a] });
    expect(result.current.entries.map((e) => [e.toast.id, e.leaving])).toEqual([
      ['a', false],
      ['b', true],
    ]);

    act(() => result.current.onExitEnd('b'));
    expect(result.current.entries).toEqual([{ toast: a, leaving: false }]);
  });

  it('processes a departure once across re-renders and tolerates repeated onExitEnd', () => {
    setReducedMotion(false);
    const a = makeToast('a');
    const b = makeToast('b');
    const { result, rerender } = renderExits([a, b]);

    rerender({ toasts: [a] });
    rerender({ toasts: [a] });
    rerender({ toasts: [a] });
    expect(result.current.entries.filter((e) => e.leaving)).toHaveLength(1);

    act(() => {
      result.current.onExitEnd('b');
      result.current.onExitEnd('b');
      result.current.onExitEnd('nope');
    });
    expect(result.current.entries).toHaveLength(1);
  });

  it('ghosts every toast of a bulk clear and clears them independently', () => {
    setReducedMotion(false);
    const a = makeToast('a');
    const b = makeToast('b');
    const c = makeToast('c');
    const { result, rerender } = renderExits([a, b, c]);

    rerender({ toasts: [] });
    expect(result.current.entries.every((e) => e.leaving)).toBe(true);
    expect(result.current.entries).toHaveLength(3);

    act(() => result.current.onExitEnd('b'));
    expect(result.current.entries.map((e) => e.toast.id)).toEqual(['a', 'c']);
    act(() => {
      result.current.onExitEnd('a');
      result.current.onExitEnd('c');
    });
    expect(result.current.entries).toEqual([]);
  });

  it('reduced motion: a departed toast unmounts immediately (no ghost)', () => {
    setReducedMotion(true);
    const a = makeToast('a');
    const b = makeToast('b');
    const { result, rerender } = renderExits([a, b]);

    rerender({ toasts: [a] });
    expect(result.current.entries).toEqual([{ toast: a, leaving: false }]);
  });

  it('pins a measured ghost at its bottom offset from the list edge', () => {
    setReducedMotion(false);
    const a = makeToast('a');
    const b = makeToast('b');
    const { result, rerender } = renderExits([a, b]);

    const list = document.createElement('ol');
    list.getBoundingClientRect = () => fakeRect(0, 200);
    result.current.listRef.current = list;

    const elB = document.createElement('li');
    elB.getBoundingClientRect = () => fakeRect(100, 140);
    act(() => result.current.registerItem('b', elB));
    // Commit once so the layout pass records b's in-flow rect.
    rerender({ toasts: [a, b] });

    rerender({ toasts: [a] });
    const ghost = result.current.entries.find((e) => e.leaving);
    expect(ghost?.style).toEqual({
      position: 'absolute',
      bottom: '60px',
      left: 0,
      right: 0,
    });
  });

  it('leaves an unmeasured ghost in flow (no pin style)', () => {
    setReducedMotion(false);
    const a = makeToast('a');
    const b = makeToast('b');
    const { result, rerender } = renderExits([a, b]);

    rerender({ toasts: [a] });
    const ghost = result.current.entries.find((e) => e.leaving);
    expect(ghost?.style).toBeUndefined();
  });

  it('FLIP-glides a survivor whose slot moved, in list-relative coordinates', () => {
    setReducedMotion(false);
    const a = makeToast('a');
    const b = makeToast('b');
    const { result, rerender } = renderExits([a, b]);

    const list = document.createElement('ol');
    let listRect = fakeRect(0, 200);
    list.getBoundingClientRect = () => listRect;
    result.current.listRef.current = list;

    const elA = document.createElement('li');
    let rectA = fakeRect(100, 140);
    elA.getBoundingClientRect = () => rectA;
    let atReflow = '';
    Object.defineProperty(elA, 'offsetHeight', {
      configurable: true,
      get() {
        atReflow = elA.style.transform;
        return 0;
      },
    });
    act(() => result.current.registerItem('a', elA));
    rerender({ toasts: [a, b] }); // record baseline rect for a

    // b departs; a drops 44px down into the freed slot.
    rectA = fakeRect(144, 184);
    rerender({ toasts: [a] });

    // Inverted start = old top - new top = -44px, then released.
    expect(atReflow).toBe('translateY(-44px)');
    expect(elA.style.transform).toBe('');

    // A pure viewport shift (list and item move together) is NOT a restack.
    atReflow = '';
    listRect = fakeRect(0, 230);
    rectA = fakeRect(174, 214);
    rerender({ toasts: [a] });
    expect(atReflow).toBe('');
  });

  it('reduced motion skips the FLIP glide', () => {
    setReducedMotion(true);
    const a = makeToast('a');
    const { result, rerender } = renderExits([a]);

    const elA = document.createElement('li');
    let rectA = fakeRect(100, 140);
    elA.getBoundingClientRect = () => rectA;
    let glided = false;
    Object.defineProperty(elA, 'offsetHeight', {
      configurable: true,
      get() {
        glided = true;
        return 0;
      },
    });
    act(() => result.current.registerItem('a', elA));
    rerender({ toasts: [a] });

    rectA = fakeRect(144, 184);
    rerender({ toasts: [a] });
    expect(glided).toBe(false);
  });

  it('registerItem(null) forgets an unmounted element', () => {
    setReducedMotion(false);
    const a = makeToast('a');
    const { result, rerender } = renderExits([a]);

    const elA = document.createElement('li');
    let rectA = fakeRect(100, 140);
    elA.getBoundingClientRect = () => rectA;
    let glided = false;
    Object.defineProperty(elA, 'offsetHeight', {
      configurable: true,
      get() {
        glided = true;
        return 0;
      },
    });
    act(() => result.current.registerItem('a', elA));
    rerender({ toasts: [a] });

    act(() => result.current.registerItem('a', null));
    rectA = fakeRect(144, 184);
    rerender({ toasts: [a] });
    expect(glided).toBe(false);
  });
});
