import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

export interface SnapCarouselHandle {
  /** Scroll slide `index` to the center of the track. */
  scrollTo: (index: number, behavior?: ScrollBehavior) => void;
}

interface Props {
  /** Parent-owned ref to the track element (swipe-dismiss + gutter measuring hook onto it). */
  trackRef: RefObject<HTMLDivElement | null>;
  count: number;
  /** Controlled: the centered slide. Reported back through `onIndexChange` as the user scrolls. */
  index: number;
  onIndexChange: (index: number) => void;
  /** Only slides within `windowRadius` of the focus are rendered; the rest are bare placeholder divs. */
  renderSlide: (index: number) => ReactNode;
  windowRadius: number;
  className: string;
  slideClassName: string | ((index: number) => string);
  /** Tapping a peeking neighbor always centers it; this fires on top for the active slide too. */
  onSlideClick?: (index: number, isActive: boolean) => void;
  /** Arrow keys page the carousel while true (parents turn it off under a stacked sheet). */
  keysEnabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
}

// The scroller is "quiet" once no scroll event has arrived for this long.
// Only then does the render window move (placeholder ↔ full slide swaps are
// DOM mutations inside a snap scroller, and Chrome re-snaps on those — never
// mid-gesture) and `is-scrolling` come off the track (CSS pauses slide
// content animations while it is on, so a pan is a pure compositor scroll).
const SETTLE_MS = 150;

/**
 * Index of the slide whose center is nearest `viewCenter`, walking outward
 * from `from`. Centers are sorted, so the walk is O(distance moved) and never
 * scans the whole list — a collection preview can have thousands of slides.
 */
export function nearestSlide(centers: readonly number[], viewCenter: number, from: number): number {
  if (centers.length === 0) return 0;
  const d = (k: number) => Math.abs(centers[k] - viewCenter);
  let i = Math.min(Math.max(from, 0), centers.length - 1);
  while (i < centers.length - 1 && d(i + 1) < d(i)) i++;
  while (i > 0 && d(i - 1) < d(i)) i--;
  return i;
}

/**
 * The one centered scroll-snap carousel behind both card-inspect sheets
 * (`CardPreview`, `BinderPagePreview`). Swiping is native scroll-snap; this
 * never writes `scrollLeft` during a gesture. Slide geometry is measured once
 * per layout (mount, resize, count change) into a list of slide centers, and
 * the centered slide is then plain arithmetic on `scrollLeft` — deterministic,
 * no observer guessing. Edge spacers are measured from the real first/last
 * slide so the first and last snap points sit exactly at the scroll extremes.
 * Styling stays with the caller via `className` / `slideClassName`; this owns
 * behavior and structure only.
 */
export const SnapCarousel = forwardRef<SnapCarouselHandle, Props>(function SnapCarousel(
  {
    trackRef,
    count,
    index,
    onIndexChange,
    renderSlide,
    windowRadius,
    className,
    slideClassName,
    onSlideClick,
    keysEnabled = true,
    prevLabel = 'Previous',
    nextLabel = 'Next',
  },
  ref
) {
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const centers = useRef<number[]>([]);
  const indexRef = useRef(index);
  indexRef.current = index;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;

  const scrollTo = (i: number, behavior: ScrollBehavior = 'smooth') => {
    slideRefs.current[i]?.scrollIntoView({ inline: 'center', block: 'nearest', behavior });
  };
  useImperativeHandle(ref, () => ({ scrollTo }));

  const [windowCenter, setWindowCenter] = useState(index);

  // Geometry. Spacers: (content width − edge slide width) / 2 − gap, so scroll
  // 0 / scroll max are the first / last snap points. Then every slide's center
  // in scroll coordinates (the leading spacer sits at the track's padding-left
  // when scrollLeft is 0). Never runs per scroll event.
  const measure = () => {
    const track = trackRef.current;
    const before = beforeRef.current;
    const slides = slideRefs.current;
    const first = slides[0];
    const last = slides[count - 1];
    if (!track || !before || !first || !last) return;
    const cs = getComputedStyle(track);
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const inner = track.clientWidth - padLeft - (parseFloat(cs.paddingRight) || 0);
    const gap = parseFloat(cs.columnGap) || 0;
    const px = (w: number) => `${Math.max(0, (inner - w) / 2 - gap)}px`;
    before.style.flexBasis = px(first.offsetWidth);
    if (afterRef.current) afterRef.current.style.flexBasis = px(last.offsetWidth);
    const origin = before.offsetLeft - padLeft;
    centers.current = slides
      .slice(0, count)
      .map((el) => (el ? el.offsetLeft + el.offsetWidth / 2 - origin : 0));
  };
  useLayoutEffect(() => {
    slideRefs.current.length = count;
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  // Initial position: jump to the requested slide without animation (after
  // the spacers above are sized, so the target lands dead center).
  useLayoutEffect(() => {
    scrollTo(index, 'instant' as ScrollBehavior);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The one scroll listener: derive the centered slide, mark the track as
  // moving, and (re)arm the settle timer. Nothing here writes to the scroller.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let timer = 0;
    const settle = () => {
      setWindowCenter(indexRef.current);
      track.classList.remove('is-scrolling');
    };
    const onScroll = () => {
      track.classList.add('is-scrolling');
      const i = nearestSlide(
        centers.current,
        track.scrollLeft + track.clientWidth / 2,
        indexRef.current
      );
      if (i !== indexRef.current) onIndexChangeRef.current(i);
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, SETTLE_MS);
    };
    track.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      track.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
    };
  }, [trackRef]);

  // A parent-driven index change with no scroll behind it still moves the window.
  useEffect(() => {
    const t = window.setTimeout(() => setWindowCenter(index), SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [index]);

  useEffect(() => {
    if (!keysEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      const cur = indexRef.current;
      let next: number | null = null;
      if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
      else if (e.key === 'ArrowRight') next = Math.min(count - 1, cur + 1);
      if (next === null) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))
      ) {
        return;
      }
      // Focus sits inside the sheet, so the browser's default arrow-key scroll
      // lands on the snap track and advances it one snap point on its own —
      // stacked on `scrollTo` below that skipped a card on every desktop press.
      e.preventDefault();
      if (next === cur) return;
      scrollTo(next);
    };
    // Capture: the sheet is the topmost overlay, so a host page's own
    // document-level key handling never preempts it.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [keysEnabled, count]);

  return (
    <>
      <div className={className} ref={trackRef}>
        <div className="snap-spacer" ref={beforeRef} aria-hidden="true" />
        {Array.from({ length: count }, (_, i) => {
          const active = i === index;
          const cls = typeof slideClassName === 'function' ? slideClassName(i) : slideClassName;
          return (
            <div
              key={i}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              className={`${cls}${active ? ' is-active' : ''}`}
              role="button"
              // Roving tabindex: a collection preview can hold thousands of
              // slides, so only the active one is a Tab stop — arrow keys
              // (handled above, independent of DOM focus) move between them.
              tabIndex={active ? 0 : -1}
              aria-label={`Slide ${i + 1} of ${count}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!active) scrollTo(i);
                onSlideClick?.(i, active);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (!active) scrollTo(i);
                  onSlideClick?.(i, active);
                }
              }}
            >
              {Math.abs(i - windowCenter) <= windowRadius ? renderSlide(i) : null}
            </div>
          );
        })}
        <div className="snap-spacer" ref={afterRef} aria-hidden="true" />
      </div>
      {count > 1 && (
        // Same grid cell as the track (see CSS), so the arrows center on the
        // slide area and ride with it as the panel below grows.
        <div className="carousel-nav-layer">
          <button
            type="button"
            className="carousel-nav carousel-nav-prev"
            onClick={(e) => {
              e.stopPropagation();
              scrollTo(index - 1);
            }}
            disabled={index <= 0}
            aria-label={prevLabel}
          >
            <ChevronLeft width={20} height={20} strokeWidth={2.4} aria-hidden />
          </button>
          <button
            type="button"
            className="carousel-nav carousel-nav-next"
            onClick={(e) => {
              e.stopPropagation();
              scrollTo(index + 1);
            }}
            disabled={index >= count - 1}
            aria-label={nextLabel}
          >
            <ChevronRight width={20} height={20} strokeWidth={2.4} aria-hidden />
          </button>
        </div>
      )}
    </>
  );
});
