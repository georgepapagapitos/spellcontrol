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
  const result = renderHook(
    ({ sel }: { sel: number }) =>
      useWheelPaging({ current: track }, { current: slides }, sel, slideCount),
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
  it('pages to the next slide once accumulated deltaX crosses the threshold', () => {
    const { track, slides } = harness();
    track.dispatchEvent(wheel(50));
    expect(slides[2].scrollIntoView).not.toHaveBeenCalled();
    track.dispatchEvent(wheel(50));
    expect(slides[2].scrollIntoView).toHaveBeenCalledWith({
      inline: 'center',
      block: 'nearest',
      behavior: 'smooth',
    });
  });

  it('pages backwards on leftward deltas', () => {
    const { track, slides } = harness();
    track.dispatchEvent(wheel(-100));
    expect(slides[0].scrollIntoView).toHaveBeenCalled();
  });

  it('prevents default on horizontal wheel so the native snap fight never starts', () => {
    const { track } = harness();
    const e = wheel(10);
    track.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('claims vertical-dominant wheel (cancelability of the whole sequence) without paging', () => {
    const { track, slides } = harness();
    const vertical = wheel(20, 100);
    track.dispatchEvent(vertical);
    // Prevented — only the FIRST event of a Chrome scroll sequence is
    // reliably cancelable, so every non-pinch tick is claimed…
    expect(vertical.defaultPrevented).toBe(true);
    // …but a vertical tick never accumulates toward a page turn.
    expect(slides[0].scrollIntoView).not.toHaveBeenCalled();
    expect(slides[2].scrollIntoView).not.toHaveBeenCalled();
  });

  it('lets pinch-zoom (ctrlKey) wheel fall through untouched', () => {
    const { track, slides } = harness();
    const pinch = wheel(200, 0, true);
    track.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
    expect(slides[0].scrollIntoView).not.toHaveBeenCalled();
    expect(slides[2].scrollIntoView).not.toHaveBeenCalled();
  });

  it('locks out further paging during the cooldown, then pages from the NEW slide', () => {
    const { track, slides, rerender } = harness();
    track.dispatchEvent(wheel(100));
    expect(slides[2].scrollIntoView).toHaveBeenCalledTimes(1);
    // momentum tail inside the cooldown: swallowed
    track.dispatchEvent(wheel(300));
    expect(slides[2].scrollIntoView).toHaveBeenCalledTimes(1);
    // carousel settled on slide 2; a fresh gesture after the cooldown pages on
    rerender({ sel: 2 });
    vi.advanceTimersByTime(600);
    track.dispatchEvent(wheel(100));
    // slide 2 is the last — clamped, no further scroll
    expect(slides[2].scrollIntoView).toHaveBeenCalledTimes(1);
    track.dispatchEvent(wheel(-100));
    expect(slides[1].scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('drops sub-threshold accumulation once the gesture goes idle', () => {
    const { track, slides } = harness();
    track.dispatchEvent(wheel(60));
    vi.advanceTimersByTime(400); // > GESTURE_IDLE_MS
    track.dispatchEvent(wheel(60));
    expect(slides[2].scrollIntoView).not.toHaveBeenCalled();
    track.dispatchEvent(wheel(60));
    expect(slides[2].scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('clamps at the edges without scrolling', () => {
    const { track, slides } = harness(0);
    track.dispatchEvent(wheel(-200));
    for (const s of slides) expect(s.scrollIntoView).not.toHaveBeenCalled();
  });
});
