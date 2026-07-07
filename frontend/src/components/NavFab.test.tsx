// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NavFab } from './NavFab';

vi.mock('../lib/use-can-scan', () => ({
  useCanScan: vi.fn(() => false),
}));

import { useCanScan } from '../lib/use-can-scan';

function renderFab() {
  return render(
    <MemoryRouter>
      <NavFab />
    </MemoryRouter>
  );
}

describe('NavFab', () => {
  it('renders the collapsed toggle without crashing', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    renderFab();
    const btn = screen.getByRole('button', { name: 'Open navigation' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('fans the five destinations out on tap', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    renderFab();
    // Collapsed: links are aria-hidden, so out of the accessibility tree.
    expect(screen.queryByRole('link', { name: 'Collection' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(
      screen.getByRole('button', { name: 'Close navigation' }).getAttribute('aria-expanded')
    ).toBe('true');
    for (const label of ['Collection', 'Decks', 'Play', 'Search', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('toggles back closed on a second tap', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });

  it('closes on Escape', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeTruthy();
  });

  it('omits the Scan action when the device cannot scan', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.queryByRole('button', { name: 'Scan' })).toBeNull();
  });

  it('exposes a Scan action chip when the device can scan', () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    renderFab();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    // Scan is the topmost (DOM-first) item in the menu, so it gets focus
    // when the menu opens.
    const scan = screen.getByRole('button', { name: 'Scan' });
    expect(scan).toBeTruthy();
    // The five nav destinations stay reachable alongside it.
    for (const label of ['Collection', 'Decks', 'Play', 'Search', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
  });
});
