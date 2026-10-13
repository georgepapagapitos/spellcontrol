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
  onSlideClick,
  renderSlide = (i: number) => <span>slide {i}</span>,
}: {
  index: number;
  count?: number;
  handle?: React.Ref<SnapCarouselHandle>;
  onSlideClick?: (index: number, isActive: boolean) => void;
  renderSlide?: (index: number) => React.ReactNode;
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
      onSlideClick={onSlideClick}
      renderSlide={renderSlide}
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

  it('leaves arrow keys to a dialog opened over it, and keeps them inside its own', () => {
    // A keyword's popover or the rules sheet over the card preview: paging the
    // cards underneath would pull the popover's anchor out from under it.
    render(
      <>
        <div role="dialog" aria-label="Split second">
          <button type="button">Read the full rule</button>
        </div>
        <div role="dialog" aria-label="Card preview">
          <button type="button">Close preview</button>
          <Harness index={1} />
        </div>
      </>
    );
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockClear();
    const press = (el: Element) => {
      const ev = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        cancelable: true,
        bubbles: true,
      });
      el.dispatchEvent(ev);
      return ev;
    };
    expect(press(screen.getByRole('button', { name: 'Read the full rule' })).defaultPrevented).toBe(
      false
    );
    expect(spy).not.toHaveBeenCalled();
    // Focus on the preview's own close button still pages the cards.
    expect(press(screen.getByRole('button', { name: 'Close preview' })).defaultPrevented).toBe(
      true
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('a slide is a plain group, so the controls it holds are not nested in a button', () => {
    // A binder page's tappable cards live inside the slide: an ARIA button
    // cannot contain them (axe nested-interactive), so the slide is a group and
    // every button on screen is a real, separate one.
    render(
      <Harness index={1} renderSlide={(i) => <button type="button">card on page {i}</button>} />
    );
    expect(screen.queryByRole('button', { name: /^Slide / })).toBeNull();
    expect(screen.getByRole('group', { name: 'Slide 2 of 5' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'card on page 1' })).toBeTruthy();
  });

  it('the track is a labelled, focusable scroll region', () => {
    render(<Harness index={0} />);
    const track = screen.getByRole('region', { name: 'Slides' });
    expect(track.tabIndex).toBe(0);
  });

  it('a tap on a peeking slide centers it and reports it, a tap on the active slide only reports', () => {
    const onSlideClick = vi.fn();
    render(<Harness index={2} onSlideClick={onSlideClick} />);
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockClear();
    fireEvent.click(screen.getByText('slide 3'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onSlideClick).toHaveBeenLastCalledWith(3, false);
    spy.mockClear();
    fireEvent.click(screen.getByText('slide 2'));
    expect(spy).not.toHaveBeenCalled();
    expect(onSlideClick).toHaveBeenLastCalledWith(2, true);
    spy.mockRestore();
  });

  it('a tap on a control inside a slide still reaches that control', () => {
    const inner = vi.fn();
    render(
      <Harness
        index={2}
        renderSlide={(i) => (
          <button type="button" onClick={inner}>
            card on page {i}
          </button>
        )}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'card on page 2' }));
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
