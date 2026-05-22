// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCenteredSlide } from './use-centered-slide';
import { createRef, type RefObject } from 'react';

class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  static instances: FakeIntersectionObserver[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    FakeIntersectionObserver.instances.push(this);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  /**
   * Fire the observer callback. The hook is entries-driven — it tracks which
   * slides are intersecting from the entries and only measures those — so the
   * fake must report intersection state per slide. Defaults to "all visible".
   */
  trigger(entries?: Array<{ target: Element; isIntersecting: boolean }>) {
    this.callback(
      (entries ?? []) as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver
    );
  }
}

/** Build "everything is intersecting" entries for a slide list. */
function allVisible(slides: HTMLElement[]) {
  return slides.map((target) => ({ target, isIntersecting: true }));
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  // @ts-expect-error – override globalThis.IntersectionObserver for the test
  globalThis.IntersectionObserver = FakeIntersectionObserver;
});

function makeSlide(left: number, width: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      left,
      right: left + width,
      width,
      top: 0,
      bottom: 0,
      x: left,
      y: 0,
      height: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

describe('useCenteredSlide', () => {
  it('does nothing when track is not yet attached', () => {
    const trackRef: RefObject<HTMLElement | null> = { current: null };
    const slideRefs: RefObject<Array<HTMLElement | null>> = { current: [] };
    renderHook(() => useCenteredSlide(trackRef, slideRefs, () => {}, []));
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
  });

  it('reports the slide whose center is closest to the track center', () => {
    const track = document.createElement('div');
    track.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 300,
        width: 300,
        top: 0,
        bottom: 0,
        x: 0,
        y: 0,
        height: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(track);
    const slides = [makeSlide(0, 100), makeSlide(120, 100), makeSlide(260, 100)];
    const trackRef = createRef<HTMLElement | null>();
    (trackRef as { current: HTMLElement | null }).current = track;
    const slideRefs = { current: slides };
    const onCenter = vi.fn();
    renderHook(() => useCenteredSlide(trackRef, slideRefs, onCenter, []));
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    FakeIntersectionObserver.instances[0].trigger(allVisible(slides));
    expect(onCenter).toHaveBeenCalledWith(1);
  });

  it('only measures slides the observer reports as intersecting', () => {
    const track = document.createElement('div');
    track.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 300,
        width: 300,
        top: 0,
        bottom: 0,
        x: 0,
        y: 0,
        height: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(track);
    // Slide 1 is the true center, but it is offscreen (not reported as
    // intersecting), so the hook must pick the closest *visible* slide.
    const slides = [makeSlide(0, 100), makeSlide(120, 100), makeSlide(260, 100)];
    // getBoundingClientRect on the offscreen slide must never be consulted.
    slides[1].getBoundingClientRect = vi.fn(() => {
      throw new Error('measured a non-intersecting slide');
    }) as unknown as () => DOMRect;
    const trackRef = createRef<HTMLElement | null>();
    (trackRef as { current: HTMLElement | null }).current = track;
    const slideRefs = { current: slides };
    const onCenter = vi.fn();
    renderHook(() => useCenteredSlide(trackRef, slideRefs, onCenter, []));
    FakeIntersectionObserver.instances[0].trigger([
      { target: slides[0], isIntersecting: true },
      { target: slides[1], isIntersecting: false },
      { target: slides[2], isIntersecting: true },
    ]);
    // Slide 0 center 50 (dist 100) beats slide 2 center 310 (dist 160).
    expect(onCenter).toHaveBeenCalledWith(0);
  });

  it('drops a slide once it stops intersecting', () => {
    const track = document.createElement('div');
    track.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 300,
        width: 300,
        top: 0,
        bottom: 0,
        x: 0,
        y: 0,
        height: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(track);
    const slides = [makeSlide(0, 100), makeSlide(120, 100), makeSlide(260, 100)];
    const trackRef = createRef<HTMLElement | null>();
    (trackRef as { current: HTMLElement | null }).current = track;
    const slideRefs = { current: slides };
    const onCenter = vi.fn();
    renderHook(() => useCenteredSlide(trackRef, slideRefs, onCenter, []));
    const observer = FakeIntersectionObserver.instances[0];
    observer.trigger(allVisible(slides));
    expect(onCenter).toHaveBeenLastCalledWith(1);
    // Slide 1 scrolls out — the next callback only reports its exit.
    observer.trigger([{ target: slides[1], isIntersecting: false }]);
    expect(onCenter).toHaveBeenLastCalledWith(0);
  });
});
