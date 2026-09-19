// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef, useRef } from 'react';
import { SnapCarousel, nearestSlide, type SnapCarouselHandle } from './SnapCarousel';

beforeAll(() => {
  // happy-dom has no layout: stub the scroll/observe APIs the carousel uses.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('nearestSlide', () => {
  const centers = [100, 300, 500, 700];
  it('picks the slide whose center is closest to the view center', () => {
    expect(nearestSlide(centers, 90, 0)).toBe(0);
    expect(nearestSlide(centers, 210, 0)).toBe(1);
    expect(nearestSlide(centers, 690, 0)).toBe(3);
    expect(nearestSlide(centers, 310, 3)).toBe(1);
  });
  it('clamps at the edges and tolerates an empty list', () => {
    expect(nearestSlide(centers, -500, 2)).toBe(0);
    expect(nearestSlide(centers, 5000, 0)).toBe(3);
    expect(nearestSlide([], 50, 4)).toBe(0);
  });
});

function Harness({
  index,
  count = 5,
  handle,
}: {
  index: number;
  count?: number;
  handle?: React.Ref<SnapCarouselHandle>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  return (
    <SnapCarousel
      ref={handle}
      trackRef={trackRef}
      count={count}
      index={index}
      onIndexChange={() => {}}
      windowRadius={1}
      className="track"
      slideClassName="slide"
      renderSlide={(i) => <span>slide {i}</span>}
    />
  );
}

describe('SnapCarousel', () => {
  it('renders every slide slot plus two edge spacers, but only windowed content', () => {
    const { container } = render(<Harness index={2} />);
    expect(container.querySelectorAll('.slide').length).toBe(5);
    expect(container.querySelectorAll('.snap-spacer').length).toBe(2);
    expect(container.querySelector('.slide.is-active')?.textContent).toBe('slide 2');
    // windowRadius 1 → slides 1..3 rendered, 0 and 4 are bare placeholders.
    expect(screen.queryByText('slide 0')).toBeNull();
    expect(screen.getByText('slide 3')).toBeTruthy();
  });

  it('disables prev at the first slide and next at the last', () => {
    const { rerender } = render(<Harness index={0} />);
    expect((screen.getByLabelText('Previous') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Next') as HTMLButtonElement).disabled).toBe(false);
    rerender(<Harness index={4} />);
    expect((screen.getByLabelText('Next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks the track is-scrolling while it moves and clears it once quiet', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(<Harness index={0} />);
      const track = container.querySelector('.track') as HTMLDivElement;
      fireEvent.scroll(track);
      expect(track.classList.contains('is-scrolling')).toBe(true);
      vi.advanceTimersByTime(100);
      fireEvent.scroll(track); // still moving — the quiet window restarts
      vi.advanceTimersByTime(100);
      expect(track.classList.contains('is-scrolling')).toBe(true);
      vi.advanceTimersByTime(100);
      expect(track.classList.contains('is-scrolling')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('arrow keys and the ref handle scroll the target slide into view', () => {
    const handle = createRef<SnapCarouselHandle>();
    render(<Harness index={1} handle={handle} />);
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockClear();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(spy).toHaveBeenCalledTimes(1);
    handle.current?.scrollTo(3, 'instant');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1][0]).toMatchObject({ inline: 'center', behavior: 'instant' });
    spy.mockRestore();
  });

  it('arrow keys swallow the browser default so the snap track is not scrolled twice', () => {
    // Focus lives inside the sheet, so an un-prevented arrow press also runs the
    // browser's native scroll on the snap track: one snap point from that, one
    // from scrollTo — two cards per press on desktop.
    render(<Harness index={1} />);
    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    window.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    const other = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    window.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('leaves arrow keys alone while a text field has focus', () => {
    render(
      <>
        <input aria-label="note" />
        <Harness index={1} />
      </>
    );
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockClear();
    const input = screen.getByLabelText('note');
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
