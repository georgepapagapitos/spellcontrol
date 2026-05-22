// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { NavFab } from './NavFab';

function renderFab() {
  return render(
    <MemoryRouter>
      <NavFab />
    </MemoryRouter>
  );
}

/** Tap the FAB the way a finger does: a paired pointerdown/up, no drift. */
function tap(el: Element) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { pointerId: 1, button: 0 });
}

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

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

    tap(screen.getByRole('button', { name: 'Open navigation' }));

    expect(
      screen.getByRole('button', { name: 'Close navigation' }).getAttribute('aria-expanded')
    ).toBe('true');
    for (const label of ['Collection', 'Decks', 'Play', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('toggles back closed on a second tap', () => {
    renderFab();
    tap(screen.getByRole('button', { name: 'Open navigation' }));
    tap(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });

  it('closes on Escape', () => {
    renderFab();
    tap(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });
});
