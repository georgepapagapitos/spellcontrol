// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWheelPaging } from './use-wheel-paging';

function wheel(deltaX: number, deltaY = 0, ctrlKey = false) {
  const e = new WheelEvent('wheel', { deltaX, deltaY, cancelable: true });
  // happy-dom's WheelEvent constructor drops ctrlKey from the init dict.
  Object.defineProperty(e, 'ctrlKey', { value: ctrlKey });
  return e;
}

function harness(selected = 1, slideCount = 3) {
  const track = document.createElement('div');
  const slides = [0, 1, 2].map(() => {
    const el = document.createElement('div');
    el.scrollIntoView = vi.fn();
    return el;
  });
  // Stable ref objects, like the components' useRef — fresh literals per
  // render would retrigger the hook's effect and clear its pending timers.
  const trackRef = { current: track };
  const slideRefs = { current: slides };
  const result = renderHook(
    ({ sel }: { sel: number }) => useWheelPaging(trackRef, slideRefs, sel, slideCount),
    { initialProps: { sel: selected } }
  );
  return { track, slides, ...result };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWheelPaging', () => {
  it('pans scrollLeft 1:1 with horizontal deltas, snap off while panning', () => {
    const { track } = harness();
    track.dispatchEvent(wheel(40));
    track.dispatchEvent(wheel(25));
    expect(track.scrollLeft).toBe(65);
    expect(track.classList.contains('is-wheel-panning')).toBe(true);
  });

  it('claims every non-pinch tick (only the FIRST event of a Chrome scroll sequence is cancelable)', () => {
    const { track } = harness();
    const horizontal = wheel(10);
    const vertical = wheel(2, 100);
    track.dispatchEvent(horizontal);
    track.dispatchEvent(vertical);
    expect(horizontal.defaultPrevented).toBe(true);
    expect(vertical.defaultPrevented).toBe(true);
  });

  it('lets pinch-zoom (ctrlKey) wheel fall through untouched', () => {
    const { track } = harness();
    const pinch = wheel(200, 0, true);
    track.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
    expect(track.scrollLeft).toBe(0);
  });

  it('a vertical-dominant tick never starts a pan', () => {
    const { track } = harness();
    track.dispatchEvent(wheel(3, 90));
    expect(track.scrollLeft).toBe(0);
    expect(track.classList.contains('is-wheel-panning')).toBe(false);
  });

  it('settles on the observer-reported slide once the gesture goes quiet, then restores snap', () => {
    const { track, slides, rerender } = harness();
    track.dispatchEvent(wheel(500));
    // observer saw the pan cross into slide 2
    rerender({ sel: 2 });
    vi.advanceTimersByTime(150); // > SETTLE_IDLE_MS
    expect(slides[2].scrollIntoView).toHaveBeenCalledWith({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
    expect(track.classList.contains('is-wheel-panning')).toBe(true); // settle in flight
    vi.advanceTimersByTime(700); // > SNAP_RESTORE_MS
    expect(track.classList.contains('is-wheel-panning')).toBe(false);
  });

  it('a light flick that never left its slide still turns one page in the gesture direction', () => {
    const { track, slides } = harness(1);
    track.dispatchEvent(wheel(130)); // ≥ FLICK_MIN_PX, selected still 1
    vi.advanceTimersByTime(150);
    expect(slides[2].scrollIntoView).toHaveBeenCalled();
    track.dispatchEvent(wheel(-130));
    vi.advanceTimersByTime(150);
    expect(slides[0].scrollIntoView).toHaveBeenCalled();
  });

  it('a sub-flick nudge settles back on the current slide', () => {
    const { track, slides } = harness(1);
    track.dispatchEvent(wheel(60)); // < FLICK_MIN_PX
    vi.advanceTimersByTime(150);
    expect(slides[1].scrollIntoView).toHaveBeenCalled();
    expect(slides[2].scrollIntoView).not.toHaveBeenCalled();
  });

  it('flick bias clamps at the last slide', () => {
    const { track, slides } = harness(2);
    track.dispatchEvent(wheel(300));
    vi.advanceTimersByTime(150);
    expect(slides[2].scrollIntoView).toHaveBeenCalledTimes(1); // recenter, not overflow
  });

  it('momentum ticks extend the gesture instead of settling mid-stream', () => {
    const { track, slides } = harness();
    track.dispatchEvent(wheel(100));
    vi.advanceTimersByTime(100); // < SETTLE_IDLE_MS — still in gesture
    track.dispatchEvent(wheel(50));
    vi.advanceTimersByTime(100);
    for (const s of slides) expect(s.scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60); // now quiet past the idle window
    const settled = slides.some(
      (s) => (s.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length > 0
    );
    expect(settled).toBe(true);
  });
});
