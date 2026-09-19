// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createPlaytestState } from '@/lib/playtest';
import { usePlaytestStore } from '../store';
import { PlaytestBoard } from './PlaytestBoard';

// PlaytestPage.test.tsx mocks PlaytestBoard wholesale (it's testing the
// page's init/resume flow, not the board), so the board itself has never
// run under a real render. This exercises it directly: a real
// createPlaytestState() seed (not a hand-typed fixture, so it can't drift
// from what the reducer actually produces) with the real store's `phase`
// pinned to 'playing' — the one flag that gates the opening-hand mulligan
// sheet off so the board itself renders instead.
const dispatch = vi.fn();

function seededState() {
  return createPlaytestState({
    library: Array.from({ length: 10 }, (_, i) => ({ id: `card-${i}`, name: `Card ${i}` })),
    openingHandSize: 7,
  });
}

beforeEach(() => {
  dispatch.mockReset();
  usePlaytestStore.setState({ phase: 'playing', dispatch });
  // Force the desktop layout — happy-dom's default viewport width matches
  // the board's own "narrow" (<=1024px) breakpoint, which would otherwise
  // swap the four ZonePile side panels for MobileZonesPanel.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

describe('PlaytestBoard', () => {
  it('renders the hand and library/graveyard/exile/command zones for a seeded game', () => {
    const state = seededState();
    render(
      <MemoryRouter>
        <PlaytestBoard state={state} />
      </MemoryRouter>
    );

    // Hand — 7 cards dealt off the 10-card library (createPlaytestState
    // shuffles by rngSeed, so which named cards land in hand vs library
    // isn't fixed — assert against the dealt hand itself, not a card index).
    expect(state.zones.hand).toHaveLength(7);
    for (const card of state.zones.hand) {
      expect(screen.getAllByText(card.name).length).toBeGreaterThan(0);
    }

    // The four zone piles (table layout — isNarrow is false at the default
    // happy-dom viewport width). Each tile carries its own count in the
    // label now, which is the whole point of the corner row.
    expect(screen.getByText('Library (3)')).toBeTruthy();
    expect(screen.getByText('Graveyard (0)')).toBeTruthy();
    expect(screen.getByText('Exile (0)')).toBeTruthy();
    expect(screen.getByText('Command (0)')).toBeTruthy();
  });

  it('puts the game menu and the turn chip in the corner instead of a toolbar row', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} backLabel="Krenko" onBack={() => {}} />
      </MemoryRouter>
    );

    // No action-bar row at the table tier, and nothing it offered is lost:
    // the menu carries the secondary actions, the corner the primary ones.
    expect(document.querySelector('.playtest-actionbar')).toBeNull();
    expect(document.querySelector('.playtest-page__header')).toBeNull();
    const menu = screen.getByRole('button', { name: 'Game menu' });
    expect(menu.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(menu);
    for (const label of ['Back to Krenko', 'Stats', 'Log', 'Shuffle', 'Mulligan', 'Reset']) {
      expect(screen.getByRole('menuitem', { name: label }), label).toBeTruthy();
    }
  });

  it('opens the table menu on a right-click on bare felt, with its shortcuts', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );

    const felt = document.querySelector('.playtest-battlefield');
    expect(felt).toBeTruthy();
    fireEvent.contextMenu(felt!, { clientX: 100, clientY: 100 });

    expect(screen.getByRole('menu', { name: 'Table actions' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Untap all/ }).textContent).toContain('U');
  });

  it('ignores a letter shortcut typed into a text field', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'd', bubbles: true });

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'DRAW', n: 1 });
    input.remove();
  });

  it('dispatches DRAW off the "d" keyboard shortcut', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { key: 'd' });

    expect(dispatch).toHaveBeenCalledWith({ type: 'DRAW', n: 1 });
  });
});
