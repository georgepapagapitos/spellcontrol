// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useCardZoom } from './use-card-zoom';

/**
 * The hook reads only `touches`, `target`, `stopPropagation` and
 * `preventDefault` off the event, so a plain Event with a `touches` array
 * stands in for a TouchEvent — happy-dom has no TouchEvent constructor.
 */
function touch(type: string, points: Array<{ x: number; y: number }>) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'touches', {
    value: points.map((p) => ({ clientX: p.x, clientY: p.y })),
  });
  return ev;
}

let sheet: HTMLDivElement;
let layer: HTMLDivElement;
let img: HTMLImageElement;

const sheetRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
const layerRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
const imgRef = createRef<HTMLImageElement>() as { current: HTMLImageElement | null };

/** happy-dom lays nothing out, so the sizes the hook measures are stubbed. */
function stubRect(el: Element, w: number, h: number) {
  el.getBoundingClientRect = () =>
    ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0 }) as DOMRect;
}

beforeEach(() => {
  sheet = document.createElement('div');
  layer = document.createElement('div');
  img = document.createElement('img');
  layer.appendChild(img);
  sheet.appendChild(layer);
  document.body.appendChild(sheet);
  // 300×420 card inside a 400×800 layer — zoomed past ~1.34× it overflows
  // horizontally, which is what makes panning meaningful.
  stubRect(img, 300, 420);
  stubRect(layer, 400, 800);
  sheetRef.current = sheet;
  layerRef.current = layer;
  imgRef.current = img;
});

afterEach(() => {
  sheet.remove();
});

const setup = (getTurn?: () => number) =>
  renderHook(() => useCardZoom({ sheetRef, layerRef, imgRef, getTurn }));

/** Current scale parsed off the imperative transform the hook writes. */
const scaleOf = () => Number(/scale\(([\d.]+)\)/.exec(img.style.transform)?.[1] ?? 1);
const translateOf = () => {
  const m = /translate3d\((-?[\d.]+)px, (-?[\d.]+)px/.exec(img.style.transform);
  return { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) };
};

describe('useCardZoom', () => {
  it('does not enter zoom until the pinch actually opens', () => {
    const { result } = setup();
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
      // Same distance — a two-finger rest, not a pinch.
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
    });
    expect(result.current.zoomed).toBe(false);
  });

  it('enters zoom on a pinch open and scales with finger distance', () => {
    const { result } = setup();
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ])
      );
    });
    expect(result.current.zoomed).toBe(true);
    expect(scaleOf()).toBeCloseTo(2, 5);
  });

  it('clamps scale to the max', () => {
    const { result } = setup();
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 5000, y: 0 },
        ])
      );
    });
    expect(result.current.zoomed).toBe(true);
    expect(scaleOf()).toBe(4);
  });

  it('snaps back out when the pinch is released near 1×', () => {
    const { result } = setup();
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
        ])
      );
    });
    expect(result.current.zoomed).toBe(true);
    act(() => {
      // Pinch back closed, then lift both fingers.
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
      sheet.dispatchEvent(touch('touchend', []));
    });
    expect(result.current.zoomed).toBe(false);
    expect(scaleOf()).toBe(1);
  });

  it('stays zoomed when released above the exit threshold', () => {
    const { result } = setup();
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ])
      );
      sheet.dispatchEvent(touch('touchend', []));
    });
    expect(result.current.zoomed).toBe(true);
    expect(scaleOf()).toBe(3);
  });

  it('pans with one finger while zoomed, clamped to the image edges', () => {
    const { result } = setup();
    act(() => {
      // Symmetric spread: the midpoint never moves, so the pinch contributes
      // no translation of its own and this test isolates the pan.
      // 3× → 900px wide against a 400px layer → ±250px of pan.
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: -50, y: 0 },
          { x: 50, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: -150, y: 0 },
          { x: 150, y: 0 },
        ])
      );
      sheet.dispatchEvent(touch('touchend', []));
    });
    expect(result.current.zoomed).toBe(true);
    expect(scaleOf()).toBe(3);
    expect(translateOf().x).toBe(0);

    act(() => {
      sheet.dispatchEvent(touch('touchstart', [{ x: 200, y: 200 }]));
      sheet.dispatchEvent(touch('touchmove', [{ x: 300, y: 200 }]));
    });
    expect(translateOf().x).toBe(100);

    act(() => {
      // Way past the edge — must clamp, not run off into dead space.
      sheet.dispatchEvent(touch('touchmove', [{ x: 9000, y: 200 }]));
    });
    expect(translateOf().x).toBe(250);
  });

  it('the card follows a two-finger drag while pinching', () => {
    const { result } = setup();
    // Already at 2.5× (750×1050 in a 400×800 layer → ±175x / ±125y of slack),
    // so the drag below lands well inside the clamp.
    act(() => result.current.zoomIn());
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: -50, y: 0 },
          { x: 50, y: 0 },
        ])
      );
      // Same spread — a pure two-finger drag of +40x/+30y, no scale change.
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: -10, y: 30 },
          { x: 90, y: 30 },
        ])
      );
    });
    expect(scaleOf()).toBe(2.5);
    expect(translateOf()).toEqual({ x: 40, y: 30 });
  });

  it('never pans a card that still fits inside the layer', () => {
    setup();
    act(() => {
      // Pinch to 1.5× → 630px tall against an 800px layer: no vertical slack.
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: -50, y: 0 },
          { x: 50, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: -75, y: 0 },
          { x: 75, y: 0 },
        ])
      );
      sheet.dispatchEvent(touch('touchend', []));
    });
    expect(scaleOf()).toBe(1.5);
    act(() => {
      sheet.dispatchEvent(touch('touchstart', [{ x: 0, y: 0 }]));
      sheet.dispatchEvent(touch('touchmove', [{ x: 0, y: 400 }]));
    });
    expect(translateOf().y).toBe(0);
  });

  it('exits on a clean tap while zoomed', () => {
    const { result } = setup();
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ])
      );
      sheet.dispatchEvent(touch('touchend', []));
    });
    expect(result.current.zoomed).toBe(true);
    act(() => {
      sheet.dispatchEvent(touch('touchstart', [{ x: 50, y: 50 }]));
      sheet.dispatchEvent(touch('touchend', []));
    });
    expect(result.current.zoomed).toBe(false);
  });

  it('treats a drag as a pan, not a tap — panning does not exit', () => {
    const { result } = setup();
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ])
      );
      sheet.dispatchEvent(touch('touchend', []));
      sheet.dispatchEvent(touch('touchstart', [{ x: 50, y: 50 }]));
      sheet.dispatchEvent(touch('touchmove', [{ x: 120, y: 50 }]));
      sheet.dispatchEvent(touch('touchend', []));
    });
    expect(result.current.zoomed).toBe(true);
  });

  it('ignores touches aimed at a control so buttons stay tappable', () => {
    const btn = document.createElement('button');
    sheet.appendChild(btn);
    const { result } = setup();
    act(() => {
      sheet.dispatchEvent(
        touch('touchstart', [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ])
      );
      sheet.dispatchEvent(
        touch('touchmove', [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
        ])
      );
      sheet.dispatchEvent(touch('touchend', []));
    });
    expect(result.current.zoomed).toBe(true);

    const ev = touch('touchstart', [{ x: 0, y: 0 }]);
    act(() => {
      btn.dispatchEvent(ev);
      btn.dispatchEvent(touch('touchend', []));
    });
    // Not swallowed, and the tap-to-exit path never ran.
    expect(ev.defaultPrevented).toBe(false);
    expect(result.current.zoomed).toBe(true);
  });

  it('zoomIn() enters zoom for mouse and keyboard users', () => {
    const { result } = setup();
    act(() => result.current.zoomIn());
    expect(result.current.zoomed).toBe(true);
    expect(scaleOf()).toBe(2.5);
  });

  it('exitZoom() resets the transform and is a no-op when not zoomed', () => {
    const { result } = setup();
    act(() => result.current.exitZoom());
    expect(result.current.zoomed).toBe(false);

    act(() => result.current.zoomIn());
    act(() => result.current.exitZoom());
    expect(result.current.zoomed).toBe(false);
    expect(scaleOf()).toBe(1);
    expect(translateOf()).toEqual({ x: 0, y: 0 });
  });

  it('composes the card rotation into the transform it writes', () => {
    const { result } = setup(() => 90);
    act(() => result.current.zoomIn());
    expect(img.style.transform).toContain('rotate(90deg)');
  });
});
