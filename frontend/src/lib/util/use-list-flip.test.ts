// @vitest-environment happy-dom
// Pure-function tests for use-list-flip helpers.
// jsdom/happy-dom return zero rects so FLIP/ghost layout is NOT tested here —
// only the pure decision logic is exercised (same pattern as use-toast-exits.ts).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import {
  computeListDepartures,
  computeListEntries,
  applyRestackGlide,
  prefersReducedMotion,
  useListFlip,
} from './use-list-flip';

// ── Departures ────────────────────────────────────────────────────────────────

describe('computeListDepartures', () => {
  it('returns keys in prev but not in next', () => {
    expect(computeListDepartures(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
  });

  it('returns empty when nothing departed', () => {
    expect(computeListDepartures(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
  });

  it('returns empty when prev is empty', () => {
    expect(computeListDepartures([], ['a', 'b'])).toEqual([]);
  });

  it('returns all prev keys when next is empty', () => {
    expect(computeListDepartures(['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('returns empty when prev === next (referential equality)', () => {
    const arr = ['a', 'b'];
    expect(computeListDepartures(arr, arr)).toEqual([]);
  });

  it('handles multiple departures', () => {
    expect(computeListDepartures(['a', 'b', 'c', 'd'], ['b'])).toEqual(['a', 'c', 'd']);
  });
});

// ── Entries ───────────────────────────────────────────────────────────────────

describe('computeListEntries', () => {
  it('returns keys in next but not in prev', () => {
    expect(computeListEntries(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c']);
  });

  it('returns empty when nothing entered', () => {
    expect(computeListEntries(['a', 'b', 'c'], ['a', 'b'])).toEqual([]);
  });

  it('returns empty when next is empty', () => {
    expect(computeListEntries(['a', 'b'], [])).toEqual([]);
  });

  it('returns all next keys when prev is empty', () => {
    expect(computeListEntries([], ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('returns empty when prev === next (referential equality)', () => {
    const arr = ['a', 'b'];
    expect(computeListEntries(arr, arr)).toEqual([]);
  });

  it('initial-seed-no-animate: seeding prevKeys with initial items means no entries on first check', () => {
    // Simulates the hook seeding prevKeys with the initial list. When the same
    // initial keys are passed as both prev and next there are no entries.
    const initial = ['Lightning Bolt', 'Counterspell', 'Sol Ring'];
    expect(computeListEntries(initial, initial)).toEqual([]);
  });
});

// ── applyRestackGlide ────────────────────────────────────────────────────────

describe('applyRestackGlide', () => {
  it('skips when deltaY is 0', () => {
    const el = {
      style: { transition: '', transform: '' },
      offsetHeight: 0,
    } as unknown as HTMLElement;
    applyRestackGlide(el, 0);
    expect(el.style.transition).toBe('');
    expect(el.style.transform).toBe('');
  });

  it('applies inverted translate then clears it for a non-zero delta', () => {
    const transitions: string[] = [];
    const transforms: string[] = [];
    const style = { transition: '', transform: '' };
    const el = {
      get offsetHeight() {
        // Capture the state at reflow time.
        transitions.push(style.transition);
        transforms.push(style.transform);
        return 0;
      },
      style,
    } as unknown as HTMLElement;

    applyRestackGlide(el, 20);

    // At reflow: transition was suppressed, transform was inverted.
    expect(transitions[0]).toBe('none');
    expect(transforms[0]).toBe('translateY(20px)');
    // After release: both cleared.
    expect(el.style.transition).toBe('');
    expect(el.style.transform).toBe('');
  });

  it('applies negative delta correctly', () => {
    const el = {
      get offsetHeight() {
        return 0;
      },
      style: { transition: 'none', transform: '' },
    } as unknown as HTMLElement;
    applyRestackGlide(el, -12);
    expect(el.style.transform).toBe('');
    expect(el.style.transition).toBe('');
  });
});

// ── prefersReducedMotion ─────────────────────────────────────────────────────

describe('prefersReducedMotion', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    // Reset any mock after each test.
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: originalMatchMedia,
    });
  });

  it('returns false when matchMedia reports reduce is false', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (_query: string) => ({ matches: false }),
    });
    expect(prefersReducedMotion()).toBe(false);
  });

  it('returns true when matchMedia reports reduce is true', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (_query: string) => ({ matches: true }),
    });
    expect(prefersReducedMotion()).toBe(true);
  });

  it('returns false when window.matchMedia is undefined', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: undefined,
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});

// ── useListFlip hook ─────────────────────────────────────────────────────────
// happy-dom getBoundingClientRect returns zero so FLIP glide/ghost-pinning are
// skipped, but the departure/entry/register/onExitEnd logic is exercised.

type Item = { name: string };
const getKey = (item: Item) => item.name;

function makeHook(initial: Item[]) {
  return renderHook(
    ({ items }: { items: Item[] }) => {
      const ref = useRef<HTMLUListElement | null>(null);
      return useListFlip(items, getKey, ref);
    },
    { initialProps: { items: initial } }
  );
}

describe('useListFlip', () => {
  it('returns live entries on initial render with no entering/leaving flags', () => {
    const items = [{ name: 'a' }, { name: 'b' }];
    const { result } = makeHook(items);
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].leaving).toBe(false);
    expect(result.current.entries[0].entering).toBe(false);
  });

  it('initial-seed-no-animate: first render has NO entering rows', () => {
    const items = [{ name: 'a' }, { name: 'b' }];
    const { result } = makeHook(items);
    const entering = result.current.entries.filter((e) => !e.leaving && e.entering);
    expect(entering).toHaveLength(0);
  });

  it('marks a newly-added key as entering on the next render', async () => {
    const initial = [{ name: 'a' }];
    const { result, rerender } = makeHook(initial);

    await act(async () => {
      rerender({ items: [{ name: 'a' }, { name: 'b' }] });
    });

    const entering = result.current.entries.filter((e) => !e.leaving && e.entering);
    expect(entering.map((e) => e.key)).toContain('b');
  });

  it('produces a leaving ghost when a key disappears', async () => {
    const initial = [{ name: 'a' }, { name: 'b' }];
    const { result, rerender } = makeHook(initial);

    await act(async () => {
      rerender({ items: [{ name: 'a' }] });
    });

    const leaving = result.current.entries.filter((e) => e.leaving);
    expect(leaving.map((e) => e.key)).toContain('b');
  });

  it('drops the ghost after onExitEnd is called', async () => {
    const initial = [{ name: 'a' }, { name: 'b' }];
    const { result, rerender } = makeHook(initial);

    await act(async () => {
      rerender({ items: [{ name: 'a' }] });
    });

    // Ghost present.
    expect(result.current.entries.some((e) => e.leaving && e.key === 'b')).toBe(true);

    await act(async () => {
      result.current.onExitEnd('b');
    });

    // Ghost removed.
    expect(result.current.entries.some((e) => e.leaving && e.key === 'b')).toBe(false);
  });

  it('registerItem stores the DOM element without throwing', () => {
    const { result } = makeHook([{ name: 'a' }]);
    const el = document.createElement('li');
    expect(() => result.current.registerItem('a', el)).not.toThrow();
    expect(() => result.current.registerItem('a', null)).not.toThrow();
  });

  it('reduced-motion: skips ghost and entering on change', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (_query: string) => ({ matches: true }),
    });

    const initial = [{ name: 'a' }, { name: 'b' }];
    const { result, rerender } = makeHook(initial);

    await act(async () => {
      rerender({ items: [{ name: 'a' }, { name: 'c' }] });
    });

    // No ghosts and no entering under reduced motion.
    expect(result.current.entries.some((e) => e.leaving)).toBe(false);
    const entering = result.current.entries.filter((e) => !e.leaving && e.entering);
    expect(entering).toHaveLength(0);

    // Restore.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: window.matchMedia,
    });
  });
});
