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
  trigger() {
    this.callback([], this as unknown as IntersectionObserver);
  }
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
    FakeIntersectionObserver.instances[0].trigger();
    expect(onCenter).toHaveBeenCalledWith(1);
  });
});
