// @vitest-environment happy-dom
// No `@testing-library/jest-dom` in this repo — assertions use plain DOM facts.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorMatchModeToggle } from './ColorMatchModeToggle';

describe('ColorMatchModeToggle', () => {
  it("renders OR with the 'any' hint and flips to 'all' on click", () => {
    const onChange = vi.fn();
    render(<ColorMatchModeToggle mode="any" onChange={onChange} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('OR');
    expect(screen.getByText('any selected color')).toBeTruthy();
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith('all');
  });

  it("renders AND with the exact-colors hint and flips back to 'any'", () => {
    const onChange = vi.fn();
    render(<ColorMatchModeToggle mode="all" onChange={onChange} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('AND');
    expect(screen.getByText('only these colors')).toBeTruthy();
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith('any');
  });

  // The visible label flips between "AND" and "OR", so `aria-pressed` on a
  // static name would be wrong (APG: aria-pressed needs a label that does
  // NOT change with state). Instead the accessible name itself states the
  // current mode and what activating the button does, both by role+name
  // (what a screen reader announces) and by DOM attribute (no stray
  // `aria-pressed` left on a control that describes its own state in words).
  it('states the current mode and the switch action in its accessible name, not aria-pressed', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorMatchModeToggle mode="any" onChange={onChange} />);
    let btn = screen.getByRole('button', { name: /any selected color.*switch to all/i });
    expect(btn.hasAttribute('aria-pressed')).toBe(false);

    rerender(<ColorMatchModeToggle mode="all" onChange={onChange} />);
    btn = screen.getByRole('button', { name: /exactly these colors.*switch to any/i });
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
  });
});
