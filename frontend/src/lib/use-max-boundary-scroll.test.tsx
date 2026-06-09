// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { clampScrollOffset, useMaxBoundaryScroll } from './use-max-boundary-scroll';

afterEach(cleanup);

describe('clampScrollOffset', () => {
  it('leaves an in-range offset untouched', () => {
    expect(clampScrollOffset(120, 1000, 400)).toBe(120);
  });

  it('snaps a negative offset (leading rubber-band) to 0', () => {
    expect(clampScrollOffset(-40, 1000, 400)).toBe(0);
  });

  it('snaps an over-max offset (trailing overshoot) to the max edge', () => {
    // max = scrollWidth - clientWidth = 600
    expect(clampScrollOffset(650, 1000, 400)).toBe(600);
  });

  it('returns the exact edges unchanged', () => {
    expect(clampScrollOffset(0, 1000, 400)).toBe(0);
    expect(clampScrollOffset(600, 1000, 400)).toBe(600);
  });

  it('clamps everything to 0 when the track is not overflowing', () => {
    expect(clampScrollOffset(50, 300, 400)).toBe(0);
    expect(clampScrollOffset(0, 300, 400)).toBe(0);
  });
});

/**
 * A scroll-track stub. Real happy-dom elements report 0 for scrollWidth/
 * clientWidth and never fire scroll on a scrollLeft write, so we model a
 * minimal track that — like a real element — re-fires a scroll event whenever
 * its `scrollLeft` is assigned. That lets us exercise the hook's feedback-loop
 * guard (the corrective write must NOT recurse into an endless clamp).
 */
class FakeTrack {
  scrollWidth: number;
  clientWidth: number;
  writes = 0;
  private _scrollLeft = 0;
  private listeners: Record<string, Array<() => void>> = {};

  constructor(scrollWidth: number, clientWidth: number) {
    this.scrollWidth = scrollWidth;
    this.clientWidth = clientWidth;
  }
  get scrollLeft() {
    return this._scrollLeft;
  }
  set scrollLeft(v: number) {
    this._scrollLeft = v;
    this.writes += 1;
    // A real element dispatches a scroll event after the offset changes.
    this.fire();
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: () => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }
  fire() {
    for (const cb of [...(this.listeners.scroll ?? [])]) cb();
  }
  /** Simulate the browser moving the offset (e.g. a momentum fling). */
  scrollTo(offset: number) {
    this.scrollLeft = offset;
  }
  hasScrollListener() {
    return (this.listeners.scroll ?? []).length > 0;
  }
}

function Harness({ track }: { track: FakeTrack }) {
  const ref = useRef<HTMLElement | null>(track as unknown as HTMLElement);
  useMaxBoundaryScroll(ref);
  return null;
}

describe('useMaxBoundaryScroll', () => {
  it('corrects an over-max scroll back to the trailing edge', () => {
    const track = new FakeTrack(1000, 400); // max = 600
    render(<Harness track={track} />);
    track.scrollTo(650);
    expect(track.scrollLeft).toBe(600);
  });

  it('corrects a negative scroll back to 0', () => {
    const track = new FakeTrack(1000, 400);
    render(<Harness track={track} />);
    track.scrollTo(-30);
    expect(track.scrollLeft).toBe(0);
  });

  it('leaves an in-range scroll alone (no corrective write)', () => {
    const track = new FakeTrack(1000, 400);
    render(<Harness track={track} />);
    track.scrollTo(250);
    expect(track.scrollLeft).toBe(250);
    expect(track.writes).toBe(1); // only the scrollTo itself, no correction
  });

  it('does not loop: the corrective write fires exactly once', () => {
    const track = new FakeTrack(1000, 400);
    render(<Harness track={track} />);
    track.scrollTo(900); // overshoot → one corrective write back to 600
    expect(track.scrollLeft).toBe(600);
    // 1 write for the scrollTo + 1 corrective write; the scroll the correction
    // re-fires is swallowed by the `correcting` guard (else this would recurse
    // / write again).
    expect(track.writes).toBe(2);
  });

  it('keeps clamping repeated overshoots after a frame resets the guard', async () => {
    const track = new FakeTrack(1000, 400);
    render(<Harness track={track} />);
    track.scrollTo(700);
    expect(track.scrollLeft).toBe(600);
    // Let the rAF guard reset before the next gesture.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    track.scrollTo(-10);
    expect(track.scrollLeft).toBe(0);
  });

  it('detaches the scroll listener on unmount', () => {
    const track = new FakeTrack(1000, 400);
    const { unmount } = render(<Harness track={track} />);
    expect(track.hasScrollListener()).toBe(true);
    unmount();
    expect(track.hasScrollListener()).toBe(false);
  });
});
