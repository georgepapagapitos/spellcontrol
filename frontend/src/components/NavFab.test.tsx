// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { NavFab } from './NavFab';

function renderFab() {
  return render(
    <MemoryRouter>
      <NavFab />
    </MemoryRouter>
  );
}

describe('NavFab', () => {
  it('renders the collapsed toggle without crashing', () => {
    renderFab();
    const btn = screen.getByRole('button', { name: 'Open navigation' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('fans the four destinations out on tap', () => {
    renderFab();
    // Collapsed: links are aria-hidden, so out of the accessibility tree.
    expect(screen.queryByRole('link', { name: 'Collection' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(
      screen.getByRole('button', { name: 'Close navigation' }).getAttribute('aria-expanded')
    ).toBe('true');
    for (const label of ['Collection', 'Decks', 'Play', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('toggles back closed on a second tap', () => {
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });

  it('closes on Escape', () => {
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });
});
