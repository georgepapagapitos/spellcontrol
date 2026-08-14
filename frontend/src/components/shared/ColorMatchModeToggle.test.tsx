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

  it("renders AND with the 'all' hint and flips back to 'any'", () => {
    const onChange = vi.fn();
    render(<ColorMatchModeToggle mode="all" onChange={onChange} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toBe('AND');
    expect(screen.getByText('all selected colors')).toBeTruthy();
    fireEvent.click(btn);
    expect(onChange).toHaveBeenCalledWith('any');
  });
});
