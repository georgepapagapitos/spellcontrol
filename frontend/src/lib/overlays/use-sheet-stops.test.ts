// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { nextStop, useSheetStops, type SheetStop } from './use-sheet-stops';

// Geometry of a 390 × 844 phone: the sheet fills the viewport, the panel is
// the sheet minus the 52px top bar, and the stage stops where the peek begins.
const SHEET_H = 844;
const PANEL_H = 792;
const PEEK_H = 291;
const PEEK_OFFSET = PANEL_H - PEEK_H; // 501
const HALF_OFFSET = PANEL_H - SHEET_H * 0.58; // 302.5

let base = 0;
beforeEach(() => {
  // happy-dom has no layout: the resting offset comes from the CSS transform,
  // which the hook reads through DOMMatrixReadOnly.
  globalThis.DOMMatrixReadOnly = class {
    m42 = base;
  } as unknown as typeof DOMMatrixReadOnly;
});

function setup(stop: SheetStop, { enabled = true, scrollTop = 0 } = {}) {
  const sheet = document.createElement('div');
  const panel = document.createElement('div');
  const inner = document.createElement('div');
  const stage = document.createElement('div');
  sheet.append(stage, panel);
  panel.append(inner);
  Object.defineProperty(sheet, 'clientHeight', { value: SHEET_H });
  Object.defineProperty(panel, 'offsetHeight', { value: PANEL_H });
  Object.defineProperty(stage, 'offsetHeight', { value: SHEET_H - PEEK_H });
  inner.scrollTop = scrollTop;
  base = { peek: PEEK_OFFSET, half: HALF_OFFSET, full: 0 }[stop];
  const onStop = vi.fn();
  const onDismiss = vi.fn();
  const { result } = renderHook(() =>
    useSheetStops({
      panelRef: { current: panel },
      innerRef: { current: inner },
      stageRef: { current: stage },
      stop,
      onStop,
      onDismiss,
      enabled: () => enabled,
    })
  );
  const ev = (y: number, target: Element = panel, x = 100) =>
    ({
      touches: [{ clientX: x, clientY: y }],
      changedTouches: [{ clientX: x, clientY: y }],
      target,
      stopPropagation: vi.fn(),
    }) as unknown as React.TouchEvent;
  /** A drag from y0 to y1 in `steps` moves, released after `ms`. */
  const drag = (y0: number, y1: number, { target = panel as Element, ms = 400 } = {}) => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const h = result.current;
    h.onTouchStart(ev(y0, target));
    for (let i = 1; i <= 6; i++) h.onTouchMove(ev(y0 + ((y1 - y0) * i) / 6, target));
    now.mockReturnValue(1000 + ms);
    const end = ev(y1, target);
    h.onTouchEnd(end);
    now.mockRestore();
    return end;
  };
  return { panel, inner, onStop, onDismiss, drag, ev, result };
}

describe('nextStop', () => {
  it('steps peek → half → full → peek', () => {
    expect(nextStop('peek')).toBe('half');
    expect(nextStop('half')).toBe('full');
    expect(nextStop('full')).toBe('peek');
  });
});

describe('useSheetStops', () => {
  it('raises the sheet to the stop nearest the release', () => {
    const { drag, onStop, panel } = setup('peek');
    drag(600, 400); // up 200px from peek: 301 ≈ the half offset
    expect(onStop).toHaveBeenCalledWith('half');
    // The inline drag offset is cleared so the CSS transition carries it home.
    expect(panel.style.transform).toBe('');
    expect(panel.classList.contains('is-dragging')).toBe(false);
  });

  it('a hard upward fling carries past half to full', () => {
    const { drag, onStop } = setup('peek');
    drag(600, 380, { ms: 60 });
    expect(onStop).toHaveBeenCalledWith('full');
  });

  it('a long drag down from peek closes the preview', () => {
    const { drag, onDismiss, onStop } = setup('peek');
    drag(600, 720);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('a short, slow drag down from peek settles back at peek', () => {
    const { drag, onDismiss, onStop } = setup('peek');
    drag(600, 640, { ms: 800 });
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledWith('peek');
  });

  it('writes the drag offset straight to the panel while the finger moves', () => {
    const { result, ev, panel } = setup('peek');
    result.current.onTouchStart(ev(600));
    result.current.onTouchMove(ev(560));
    expect(panel.style.transform).toBe(`translateY(${PEEK_OFFSET - 40}px)`);
    expect(panel.classList.contains('is-dragging')).toBe(true);
  });

  it('at full, content that has scrolled keeps its native scroll', () => {
    const { drag, onStop, inner, panel } = setup('full', { scrollTop: 120 });
    drag(300, 400, { target: inner });
    expect(onStop).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe('');
  });

  it('at full, dragging down from the top of the content lowers the sheet', () => {
    const { drag, onStop, inner } = setup('full');
    drag(200, 420, { target: inner });
    expect(onStop).toHaveBeenCalledWith('half');
  });

  it('a mostly sideways move is left to the carousel', () => {
    const { result, ev, onStop, panel } = setup('peek');
    result.current.onTouchStart(ev(600, panel, 100));
    result.current.onTouchMove(ev(604, panel, 160));
    result.current.onTouchEnd(ev(604, panel, 160));
    expect(onStop).not.toHaveBeenCalled();
  });

  it('does nothing in the two-column layout, but still stops propagation', () => {
    const { drag, onStop, onDismiss } = setup('peek', { enabled: false });
    const end = drag(600, 300);
    expect(onStop).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    // The preview's own swipe-to-close must never see a sheet gesture.
    expect(end.stopPropagation).toHaveBeenCalled();
  });

  it('a cancelled touch releases without a stop change', () => {
    const { result, ev, onStop, panel } = setup('peek');
    result.current.onTouchStart(ev(600));
    result.current.onTouchMove(ev(560));
    result.current.onTouchCancel(ev(560));
    expect(panel.classList.contains('is-dragging')).toBe(false);
    expect(onStop).toHaveBeenCalledWith('peek');
  });
});
