// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { PlayPage } from './PlayPage';

function renderPage(initialEntry = '/play') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PlayPage />
    </MemoryRouter>
  );
}

describe('PlayPage tabs', () => {
  it('renders Local/Online/Game nights/History through the shared Tabs primitive', () => {
    const { container } = renderPage();
    const tablist = screen.getByRole('tablist', { name: 'Play sections' });
    expect(tablist.classList.contains('sc-tabs')).toBe(true);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Local', 'Online', 'Game nights', 'History']);
    // No hand-rolled strip left behind.
    expect(container.querySelector('.play-tabs')).toBeNull();
  });

  it('defaults to the Local tab with roving tabindex', () => {
    renderPage();
    const local = screen.getByRole('tab', { name: 'Local' });
    expect(local.getAttribute('aria-selected')).toBe('true');
    expect(local.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Online' }).getAttribute('tabindex')).toBe('-1');
    // Local setup form is the visible panel.
    expect(screen.getByText('New local game')).toBeTruthy();
  });

  it('switches panels on tab click', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('No games yet')).toBeTruthy();
    expect(screen.queryByText('New local game')).toBeNull();
  });

  it('honors the ?tab= query param for the initial tab', () => {
    renderPage('/play?tab=history');
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('No games yet')).toBeTruthy();
  });
});
