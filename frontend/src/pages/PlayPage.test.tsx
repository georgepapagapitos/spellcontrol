// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { PlayPage } from './PlayPage';
import { useRulesReferenceStore } from '../store/rules-reference';
import { usePlayStore } from '../store/play';

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
    expect(screen.getByText('No games yet.')).toBeTruthy();
    expect(screen.queryByText('New local game')).toBeNull();
  });

  it('honors the ?tab= query param for the initial tab', () => {
    renderPage('/play?tab=history');
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('No games yet.')).toBeTruthy();
  });
});

describe('Local setup — seat name field (B7-05)', () => {
  it('seeds the name field empty, not a live "Player N" value', () => {
    renderPage();
    const seat1 = screen.getByRole('textbox', { name: 'Player 1 name' }) as HTMLInputElement;
    expect(seat1.value).toBe('');
    expect(seat1.placeholder).toBe('Player 1');
  });

  it('falls back to "Player N" for a seat left blank, without concatenating a typed name', () => {
    renderPage();
    const seat2 = screen.getByRole('textbox', { name: 'Player 2 name' }) as HTMLInputElement;
    fireEvent.change(seat2, { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    expect(screen.getByText('Player 1')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByText(/Player 1\w/)).toBeNull();
  });
});

describe('PlayPage rules button', () => {
  it('opens the rules reference sheet', () => {
    renderPage();
    expect(useRulesReferenceStore.getState().isOpen).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Rules' }));
    expect(useRulesReferenceStore.getState().isOpen).toBe(true);
  });
});

// E300 — the landing page's "Start a game" door deep-links here with `new=1`
// and must land on a RUNNING table, not the setup form. If this regresses the
// door silently becomes "one tap to a form", which is the thing it existed to
// fix.
describe('PlayPage — ?new=1 deep link', () => {
  const seat = (name: string) => ({
    name,
    deckId: null,
    deckName: null,
    commander: null,
    partner: null,
    colorIdentity: [],
  });

  beforeEach(() => {
    usePlayStore.setState({ local: null });
  });

  it('opens a running table on the Commander defaults, skipping the setup form', () => {
    renderPage('/play?new=1');
    expect(screen.queryByText('New local game')).toBeNull();
    // Exactly what an untouched LocalSetup would submit: 2 seats, blank names
    // falling back to "Player N", 40 life.
    expect(screen.getByText('Player 1')).toBeTruthy();
    expect(screen.getByText('Player 2')).toBeTruthy();
    expect(screen.queryByText('Player 3')).toBeNull();
    expect(screen.getAllByText('40').length).toBeGreaterThan(0);
  });

  it('never clobbers a game already in progress', () => {
    usePlayStore.getState().startLocal({
      format: 'commander',
      startingLife: 40,
      commanderDamageEnabled: true,
      poisonEnabled: false,
      players: [seat('Alice'), seat('Bob')],
    });
    renderPage('/play?new=1');
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByText('Player 1')).toBeNull();
  });

  it('leaves a plain /play on the setup form — no accidental auto-start', () => {
    renderPage('/play');
    expect(screen.getByText('New local game')).toBeTruthy();
    expect(usePlayStore.getState().local).toBeNull();
  });
});
