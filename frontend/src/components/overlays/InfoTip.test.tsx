// @vitest-environment happy-dom
/**
 * Regression: focusing a trigger below the fold (keyboard Tab-navigating
 * down a long settings-style page) makes the browser scroll it into view as
 * part of focusing. That scroll must not immediately close the tooltip the
 * same focus just opened — it used to, because the dismiss-on-scroll
 * listener armed synchronously and reacted to the very first scroll event
 * regardless of cause, making the reveal functionally unreachable via
 * keyboard for any off-screen trigger.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InfoTip } from './InfoTip';

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('InfoTip reveal model', () => {
  it('opens on focus and stays open through a scroll fired the same tick (focus-driven scrollIntoView)', () => {
    render(<InfoTip label="test concept" text="Explainer body" />);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeTruthy();

    fireEvent.scroll(window);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('still closes on a genuine later scroll (the user scrolling away)', async () => {
    render(<InfoTip label="test concept" text="Explainer body" />);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeTruthy();

    await act(nextFrame);
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('mouse hover still opens and mouse-leave still closes', () => {
    render(<InfoTip label="test concept" text="Explainer body" />);
    const btn = screen.getByRole('button');
    fireEvent.mouseEnter(btn);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<InfoTip label="test concept" text="Explainer body" />);
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

// 2026-11-02, the user's report: the Build health ⓘ (right column of Deck
// stats) opened its bubble at the far LEFT of the screen. computePopoverPlacement
// right-aligns a trigger near the right edge and returns `right`; InfoTip read
// only `left` (`left ?? 8`), so the bubble fell to left: 8px.
describe('InfoTip placement next to its trigger', () => {
  const rect = (left: number, top: number, w = 16, h = 16) =>
    ({
      left,
      top,
      right: left + w,
      bottom: top + h,
      width: w,
      height: h,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;

  function openAt(triggerLeft: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    render(<InfoTip label="build health" text="Each part scores out of 100." />);
    const btn = screen.getByRole('button');
    btn.getBoundingClientRect = () => rect(triggerLeft, 340);
    fireEvent.focus(btn);
    return screen.getByRole('tooltip');
  }

  it('a trigger near the right edge opens right-aligned under it, not at the far left', () => {
    const tip = openAt(1400); // trigger spans 1400-1416 on a 1440 px screen
    expect(tip.style.left).toBe('');
    expect(tip.style.right).toBe(`${1440 - 1416}px`); // bubble's right edge = trigger's right edge
  });

  it('a trigger with room to its right still opens left-aligned under it', () => {
    const tip = openAt(200);
    expect(tip.style.left).toBe('200px');
    expect(tip.style.right).toBe('');
  });
});
