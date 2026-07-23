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
