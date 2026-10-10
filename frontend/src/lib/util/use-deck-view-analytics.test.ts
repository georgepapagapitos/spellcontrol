// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const track = vi.fn();
vi.mock('./analytics', () => ({ track: (...args: unknown[]) => track(...args) }));

const { useDeckViewAnalytics } = await import('./use-deck-view-analytics');

/** A controllable IntersectionObserver: `fire(true)` reports every observed element as on screen. */
let observers: { cb: IntersectionObserverCallback; els: Element[]; live: boolean }[] = [];
function fire(isIntersecting: boolean) {
  for (const o of observers.filter((x) => x.live)) {
    o.cb(
      o.els.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry),
      {} as IntersectionObserver
    );
  }
}

beforeEach(() => {
  track.mockReset();
  observers = [];
  globalThis.IntersectionObserver = class {
    private o: (typeof observers)[number];
    constructor(cb: IntersectionObserverCallback) {
      this.o = { cb, els: [], live: true };
      observers.push(this.o);
    }
    observe(el: Element) {
      this.o.els.push(el);
    }
    disconnect() {
      this.o.live = false;
    }
    unobserve() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const heading = () => ({ current: document.createElement('h3') });

describe('useDeckViewAnalytics', () => {
  it('counts the Power and Coach tabs each time they open, and never the Deck tab', () => {
    const ref = heading();
    const { rerender } = renderHook(({ view }) => useDeckViewAnalytics(view, ref), {
      initialProps: { view: 'deck' },
    });
    expect(track).not.toHaveBeenCalledWith('deck_power_viewed');
    rerender({ view: 'power' });
    rerender({ view: 'tune' });
    rerender({ view: 'power' });
    expect(track.mock.calls.map((c) => c[0])).toEqual([
      'deck_power_viewed',
      'deck_coach_viewed',
      'deck_power_viewed',
    ]);
  });

  it('counts the stats once, only when the heading is actually on screen', () => {
    const ref = heading();
    const { rerender } = renderHook(({ view }) => useDeckViewAnalytics(view, ref), {
      initialProps: { view: 'deck' },
    });
    fire(false);
    expect(track).not.toHaveBeenCalled();
    fire(true);
    fire(true);
    expect(track.mock.calls).toEqual([['deck_stats_viewed']]);
    // Leaving for another tab and coming back to the Deck tab is the same visit.
    rerender({ view: 'power' });
    rerender({ view: 'deck' });
    fire(true);
    expect(track.mock.calls.filter((c) => c[0] === 'deck_stats_viewed')).toHaveLength(1);
  });

  it('does nothing for the stats when the heading is not mounted', () => {
    renderHook(() => useDeckViewAnalytics('power', { current: null }));
    expect(observers).toHaveLength(0);
  });
});
