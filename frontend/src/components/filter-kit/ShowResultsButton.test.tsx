// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShowResultsButton } from './ShowResultsButton';

const noop = () => {};

describe('ShowResultsButton', () => {
  it('is the primary action with a localized, plural-aware count', () => {
    const onClick = vi.fn();
    const { container } = render(<ShowResultsButton count={1234} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Show 1,234 cards' });
    expect(btn.className).toContain('btn-primary');
    expect(container.firstElementChild!.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is singular at one, and takes any noun', () => {
    const { rerender } = render(<ShowResultsButton count={1} onClick={noop} />);
    expect(screen.getByRole('button', { name: 'Show 1 card' })).toBeTruthy();
    rerender(<ShowResultsButton count={3} noun="deck" onClick={noop} />);
    expect(screen.getByRole('button', { name: 'Show 3 decks' })).toBeTruthy();
    rerender(<ShowResultsButton count={2} noun="person" plural="people" onClick={noop} />);
    expect(screen.getByRole('button', { name: 'Show 2 people' })).toBeTruthy();
  });

  it('says no match at zero, in the danger tone and not primary', () => {
    render(<ShowResultsButton count={0} onClick={noop} />);
    const btn = screen.getByRole('button', { name: 'No cards match' });
    expect(btn.className).toContain('btn-danger');
    expect(btn.className).not.toContain('btn-primary');
  });

  it('shows a plain label while the count is unknown', () => {
    render(<ShowResultsButton count={null} onClick={noop} />);
    expect(screen.getByRole('button', { name: 'Show cards' })).toBeTruthy();
  });
});
