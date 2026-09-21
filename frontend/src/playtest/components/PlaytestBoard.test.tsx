// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { applyAction, createPlaytestState } from '@/lib/playtest';
import { usePlayStore } from '@/store/play';
import { usePlaytestStore } from '../store';
import type { OnlineTable } from '../hooks/use-online-table';
import type { OpponentSeat } from './OpponentRail';
import { opponentPreviewId } from './OpponentQuadrant';
import { PlaytestBoard } from './PlaytestBoard';

// The seat grid needs a seated online table. `useOnlineTable` is the one seam
// between playtest and an online game (see its doc comment), so mocking it is
// mocking the whole multiplayer world; `onlineTable` below is what the tests
// hand the board.
let onlineTable: OnlineTable | null = null;
vi.mock('../hooks/use-online-table', () => ({
  useOnlineTable: () => onlineTable,
}));
// The token picker's two seams: the deck-token list (echoed back as a name
// so the test can see HOW MANY deck cards the board passed down) and the
// live Scryfall lookups, which must never fire in a unit test.
vi.mock('@/components/deck/use-deck-tokens', () => ({
  useDeckTokens: (cards: unknown[]) =>
    cards.length > 0 ? [{ name: `deck-cards-${cards.length}`, producers: [] }] : [],
}));
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  searchTokens: async () => [],
  resolveTokenOption: async () => null,
}));

// Art resolution for the quadrants' cards — see OpponentQuadrant.test.tsx.
vi.mock('@/lib/card-thumbs', () => ({
  useCardThumb: (name?: string) => (name ? `https://cards.example/${name}.jpg` : undefined),
  cachedCardThumb: (name: string) => `https://cards.example/${name}.jpg`,
}));

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

function opponent(seat: number): OpponentSeat {
  return {
    name: `Player ${seat}`,
    board: {
      seat,
      turn: 3,
      life: 34,
      commanderTax: {},
      monarch: false,
      initiative: false,
      citysBlessing: false,
      battlefield: [
        {
          card: { id: 'sol', name: 'Sol Ring' },
          tapped: false,
          counters: {},
          stickers: [],
          x: 0.2,
          y: 0.3,
          faceDown: false,
        },
      ],
      graveyard: [],
      exile: [],
      command: [],
      handCount: 4,
      libraryCount: 88,
    },
  };
}

function seatedTable(opponents: OpponentSeat[]): OnlineTable {
  return {
    activeSeat: 0,
    opponents,
    mySeat: 0,
    isHost: false,
    me: { seat: 0, name: 'Dev', life: 40 } as OnlineTable['me'],
    players: [{ seat: 0, name: 'Dev', life: 40 } as OnlineTable['me']],
    phase: undefined,
    poisonEnabled: false,
    commanderDamageEnabled: false,
    mulliganType: 'commander' as const,
    turnTimerEnabled: false,
    turnStartedAt: null,
    designations: { monarch: null, initiative: null },
    dispatch: () => {},
  };
}

/** Evaluate the board's real media queries against a width, the way
 *  OpponentRail.test.tsx does, so the seat grid's own `(min-width: 1440px)`
 *  gate is exercised rather than stubbed away. */
function stubWidth(width: number, finePointer = false) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches =
        (!min || width >= Number(min[1])) &&
        (!max || width <= Number(max[1])) &&
        (finePointer || !/hover|pointer/.test(query)) &&
        !/orientation/.test(query);
      return {
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    },
  });
}

beforeEach(() => {
  dispatch.mockReset();
  onlineTable = null;
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
    expect(menu.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(menu);
    const drawer = screen.getByRole('dialog', { name: 'Game menu' });
    for (const label of [
      'Back to Krenko',
      'Stats',
      'Log',
      'Rules reference',
      'Keyboard shortcuts',
      'Table settings',
      'Start a new game',
    ]) {
      expect(within(drawer).getByRole('button', { name: label }), label).toBeTruthy();
    }
    // Grouped, with the game-enders kept out of the scrolling list.
    for (const group of ['Table', 'Settings', 'Game']) {
      expect(within(drawer).getByRole('heading', { name: group }), group).toBeTruthy();
    }
    expect(
      within(drawer)
        .getByRole('button', { name: 'Start a new game' })
        .closest('.playtest-game-menu__end')
    ).toBeTruthy();
    // Library actions moved onto the library pile, and the set-and-forget
    // preferences behind "Table settings" — the menu is actions now.
    for (const gone of ['Shuffle', 'Mulligan', 'Top cards', 'Resistance: Off']) {
      expect(within(drawer).queryByRole('button', { name: gone }), gone).toBeNull();
    }
  });

  // The library's click is Draw, and everything else about the library is on
  // its menu — reachable three ways, because right-click alone is neither
  // keyboard- nor touch-reachable.
  it('draws on a click of the library pile, and never on a click of another pile', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /^Draw a card\./ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'DRAW', n: 1 });

    dispatch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^View the graveyard\./ }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /Graveyard/ })).toBeTruthy();
  });

  it('opens the library menu on a right-click, on the kebab, and on the Context Menu key', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    const tile = screen.getByRole('button', { name: /^Draw a card\./ });

    // 1. Right-click anywhere on the tile.
    fireEvent.contextMenu(tile, { clientX: 40, clientY: 40 });
    const menu = screen.getByRole('menu', { name: 'Library' });
    for (const label of [
      /^Draw a card/,
      /^Draw several/,
      /^View/,
      /^Shuffle/,
      /^Select a random card/,
      /^Move all to/,
    ]) {
      expect(within(menu).getByRole('menuitem', { name: label }), String(label)).toBeTruthy();
    }
    // The menu is where the library's keys are discovered, so every row that
    // has one prints it.
    expect(within(menu).getByRole('menuitem', { name: /^Shuffle/ }).textContent).toContain('S');
    fireEvent.keyDown(window, { key: 'Escape' });

    // 2. The kebab, which is what a keyboard or a touchscreen reaches for.
    fireEvent.click(screen.getByRole('button', { name: 'Library actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Shuffle/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SHUFFLE_LIBRARY' });
  });

  // The five ways of looking are one row that opens onto them, not five
  // rows on the root — which is what keeps the root readable now that the
  // reveals live there too.
  it('groups every way of looking at the library behind View, keys included', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Draw a card\./ }), {
      clientX: 20,
      clientY: 20,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: /^View/ }));
    for (const label of [/^Top card/, /^Bottom card/, /^Top X cards/, /^Bottom X cards/, /^All/]) {
      expect(screen.getByRole('menuitem', { name: label }), String(label)).toBeTruthy();
    }
    expect(screen.getByRole('menuitem', { name: /^All/ }).textContent).toContain('V');
    expect(screen.getByRole('menuitem', { name: /^Top X cards/ }).textContent).toContain('P');

    fireEvent.click(screen.getByRole('menuitem', { name: /^All/ }));
    expect(screen.getByRole('dialog', { name: /Library/ })).toBeTruthy();
  });

  // Every EDHPlay library action our menu was missing. They all hang off the
  // same right-click, so they are exercised through it rather than by
  // reaching for the component.
  function openLibraryMenu() {
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Draw a card\./ }), {
      clientX: 20,
      clientY: 20,
    });
  }

  it('draws a chosen number of cards from the Draw several page', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Draw several/ }));
    // Opens on 2 — one card is what the row above it already does.
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Draw 3 cards' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'DRAW', n: 3 });
  });

  it('never offers to draw more cards than the library holds', () => {
    // A three-card library (seededState deals 7 of 10 to hand).
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Draw several/ }));
    const more = screen.getByRole('button', { name: 'One more' });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: 'Draw 3 cards' })).toBeTruthy();
    expect((more as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a random card without moving it', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select a random card' }));
    expect(screen.getByText('Random card selected')).toBeTruthy();
    // Selecting one is not yet a move — the reducer hears nothing until a
    // destination is picked.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('gives the random card somewhere to go, and a way to put it back', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select a random card' }));
    const moves = screen.getByRole('group', { name: 'Move to' });
    for (const label of ['Hand', 'Battlefield', 'Graveyard', 'Exile']) {
      expect(within(moves).getByRole('button', { name: label }), label).toBeTruthy();
    }

    fireEvent.click(within(moves).getByRole('button', { name: 'Graveyard' }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MOVE_TO_ZONE', to: 'graveyard' })
    );
    // The panel closes behind the move rather than sitting on a card that
    // is no longer where it was found.
    expect(screen.queryByText('Random card selected')).toBeNull();
  });

  it('puts the random card back without touching the reducer', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Select a random card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Put back' }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByText('Random card selected')).toBeNull();
  });

  it('sends the top cards to the graveyard or exile in bulk, face down on request', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Move top cards to/ }));
    for (const label of ['Graveyard', 'Exile', 'Exile face down']) {
      expect(screen.getByRole('menuitem', { name: label }), label).toBeTruthy();
    }

    // Each destination names its own verb on the button that does it.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Graveyard' }));
    expect(screen.getByRole('button', { name: 'Mill 1 card' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mill 2 cards' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'MOVE_TOP_N', n: 2, to: 'graveyard' });
  });

  it('carries face down through to the action, not just the label', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Move top cards to/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exile face down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exile 1 card face down' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_TOP_N',
      n: 1,
      to: 'exile',
      faceDown: true,
    });
  });

  // Solo there is no audience, so the standing reveal collapses to its
  // private half and is a plain toggle rather than a choice of who sees it.
  it('plays with the top revealed, privately, and turns the pile face up while it is on', () => {
    const { rerender } = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    // Off to begin with: the library shows a card back, not a card.
    expect(document.querySelector('.playtest-pile__back--library')).toBeTruthy();

    openLibraryMenu();
    const row = screen.getByRole('menuitemcheckbox', { name: /Play with top revealed/ });
    expect(row.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(row);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LIBRARY_REVEAL', reveal: 'top-me' });

    const revealed = applyAction(seededState(), { type: 'SET_LIBRARY_REVEAL', reveal: 'top-me' });
    rerender(
      <MemoryRouter>
        <PlaytestBoard state={revealed} />
      </MemoryRouter>
    );
    expect(document.querySelector('.playtest-pile__back--library')).toBeNull();
    openLibraryMenu();
    // Picking the mode it is already in is how you turn it back off.
    const on = screen.getByRole('menuitemcheckbox', { name: /Play with top revealed/ });
    expect(on.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(on);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LIBRARY_REVEAL', reveal: 'none' });
  });

  it('offers no one-shot reveal at all when solo — every audience is nobody', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    expect(screen.queryByRole('menuitem', { name: /^Reveal top card/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Reveal library/ })).toBeNull();
    // The private one is still there, as a toggle and not a submenu.
    expect(screen.getByRole('menuitemcheckbox', { name: /Play with top revealed/ })).toBeTruthy();
  });

  it('empties a zone into another from Move all to', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /Move all to/ }));
    // The zone the cards are already in is not a destination.
    expect(screen.queryByRole('menuitem', { name: /^Library/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Graveyard' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_ALL_TO',
      from: 'library',
      to: 'graveyard',
      toIndex: undefined,
    });
  });

  it('gives every pile a menu, with the graveyard its shuffle-back', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard
          state={applyAction(seededState(), {
            type: 'MOVE_TO_ZONE',
            cardId: 'card-0',
            to: 'graveyard',
          })}
        />
      </MemoryRouter>
    );
    fireEvent.contextMenu(screen.getByRole('button', { name: /^View the graveyard\./ }), {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Shuffle into the library' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SHUFFLE_ZONE_INTO_LIBRARY',
      zone: 'graveyard',
    });
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

  it('lays every seat out as a quadrant at 1440px and up, and keeps the rail below it', () => {
    onlineTable = seatedTable([opponent(1), opponent(2), opponent(3)]);
    stubWidth(1920);
    const { container, unmount } = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(container.querySelector('.playtest-main--grid')).toBeTruthy();
    expect(container.querySelectorAll('.opponent-quadrant')).toHaveLength(3);
    expect(container.querySelector('.opponent-rail')).toBeNull();
    unmount();

    // One pixel under the gate, the rail is still the answer.
    stubWidth(1439);
    const below = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(below.container.querySelector('.playtest-main--grid')).toBeNull();
    expect(below.container.querySelector('.opponent-rail')).toBeTruthy();
  });

  it('fills the fourth quadrant with an open seat at a three-player table', () => {
    onlineTable = seatedTable([opponent(1), opponent(2)]);
    stubWidth(1920);
    const { container } = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(container.querySelectorAll('.opponent-quadrant--open')).toHaveLength(1);
    expect(screen.getByText('Open seat')).toBeTruthy();
  });

  it('never grids a table it would have to hide a seat from', () => {
    onlineTable = seatedTable([opponent(1), opponent(2), opponent(3), opponent(4)]);
    stubWidth(1920);
    const { container } = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(container.querySelector('.playtest-main--grid')).toBeNull();
    expect(container.querySelector('.opponent-rail')).toBeTruthy();
  });

  it('insets the top-right cell at every seat count, so the turn stack covers no board', () => {
    stubWidth(1920);
    // Four seats: the second of the upper pair holds the top-right cell.
    onlineTable = seatedTable([opponent(1), opponent(2), opponent(3)]);
    const four = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    let inset = four.container.querySelectorAll('.opponent-quadrant--under-stack');
    expect(inset).toHaveLength(1);
    expect(
      inset[0].getAttribute('aria-label'),
      'the top-right cell is the SECOND opponent'
    ).toContain('Player 2');
    four.unmount();

    // Two seats: the single opponent IS the right column, top corner included.
    onlineTable = seatedTable([opponent(1)]);
    const two = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    inset = two.container.querySelectorAll('.opponent-quadrant--under-stack');
    expect(inset).toHaveLength(1);
    expect(inset[0].getAttribute('aria-label')).toContain('Player 1');
  });

  it('resolves an opponent permanent for the hover preview off its seat-scoped id', () => {
    onlineTable = seatedTable([opponent(1)]);
    stubWidth(1920, true);
    vi.useFakeTimers();
    try {
      const { container } = render(
        <MemoryRouter>
          <PlaytestBoard state={seededState()} />
        </MemoryRouter>
      );
      const id = opponentPreviewId(1, 'sol');
      const card = container.querySelector(`[data-preview-id="${id}"]`);
      expect(card, 'the quadrant publishes a seat-scoped preview id').toBeTruthy();

      // The board's own `resolvePreview` is what turns that prefixed id back
      // into a face — nothing else in the app knows the prefix.
      fireEvent.pointerOver(card!);
      act(() => {
        vi.advanceTimersByTime(300);
      });
      const shown = document.querySelector('.playtest-hover-preview img');
      expect(shown?.getAttribute('src')).toBe('https://cards.example/Sol Ring.jpg');
    } finally {
      vi.useRealTimers();
    }
  });
});

// Rebindable shortcuts (lib/shortcuts): the board's one handler resolves keys
// through the saved bindings, so a rebound key acts and the old one doesn't.
describe('PlaytestBoard — rebindable shortcuts', () => {
  beforeEach(() => localStorage.clear());

  it('S shuffles, ↑ adjusts life, and I opens the shortcuts sheet', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: 's' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SHUFFLE_LIBRARY' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'ADJUST_LIFE', player: 'self', delta: 1 });
    fireEvent.keyDown(window, { key: 'i' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
    // With the sheet open the board's keys are off — the sheet owns the keyboard.
    dispatch.mockClear();
    fireEvent.keyDown(window, { key: 'd' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('honours a saved rebinding: W draws and D no longer does', () => {
    localStorage.setItem('playtest-shortcuts-v1', JSON.stringify({ draw: 'j' }));
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: 'd' });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'DRAW', n: 1 });
    fireEvent.keyDown(window, { key: 'j' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'DRAW', n: 1 });
    // The library menu's Draw prints the live key, not the default — the
    // menu is the only place a Draw key is written down now.
    fireEvent.click(screen.getByRole('button', { name: 'Library actions' }));
    expect(screen.getByRole('menuitem', { name: /^Draw a card/ }).textContent).toContain('J');
  });
});

/**
 * `=` and `-` read the context (EDHPlay's own mapping, and what this board
 * did before the keyboard map split them apart): a card targeted means a
 * ±1/±1 counter, nothing targeted means card size. The shifted forms only
 * ever mean a counter.
 */
describe('PlaytestBoard — = and − read the context', () => {
  beforeEach(() => localStorage.clear());

  /** A state with one permanent on the battlefield, so there is something to
   *  target — `seededState` deals a hand and a library only. */
  function withPermanent() {
    const base = seededState();
    return applyAction(base, {
      type: 'MOVE_TO_BATTLEFIELD',
      cardId: base.zones.hand[0].id,
      x: 0,
      y: 0,
    });
  }

  it('puts a counter on the selection instead of resizing, and leaves the zoom alone', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={withPermanent()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true }); // select every permanent
    dispatch.mockClear();

    fireEvent.keyDown(window, { key: '=' });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_COUNTER', counter: '+1/+1', delta: 1 })
    );
    fireEvent.keyDown(window, { key: '-' });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_COUNTER', counter: '-1/-1', delta: 1 })
    );
    // The cards never resized: the keys belonged to the selection.
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('1');
  });

  it('the shifted forms mean a counter whatever is targeted, and never resize', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={withPermanent()} />
      </MemoryRouter>
    );
    // Nothing selected: the shifted keys still only ever mean a counter, so
    // they no-op rather than falling through to the zoom.
    fireEvent.keyDown(window, { key: '+' });
    fireEvent.keyDown(window, { key: '_' });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_COUNTER' }));
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('1');

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(window, { key: '+' });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_COUNTER', counter: '+1/+1', delta: 1 })
    );
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('1');
  });
});

// Card size on the wide tier: = and − zoom when nothing is selected, the
// value lives on <body> so the drag overlay inherits it, and it is remembered.
describe('PlaytestBoard — card size', () => {
  beforeEach(() => localStorage.clear());

  it('= and − step the zoom with nothing selected, and the settings sheet shows and sets it', () => {
    const { unmount } = render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('1');
    fireEvent.keyDown(window, { key: '=' });
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('1.1');
    fireEvent.keyDown(window, { key: '-' });
    fireEvent.keyDown(window, { key: '-' });
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('0.9');
    expect(localStorage.getItem('playtest-zoom-v1')).toBe('0.9');
    // No counter was ever asked for: nothing selected means the keys zoom.
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_COUNTER' }));
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Table settings' }));
    const slider = screen.getByRole('slider', { name: 'Card size' });
    expect(slider.getAttribute('aria-valuetext')).toBe('90%');
    fireEvent.change(slider, { target: { value: '1.3' } });
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('1.3');
    expect(localStorage.getItem('playtest-zoom-v1')).toBe('1.3');
    fireEvent.click(screen.getByRole('button', { name: 'Reset card size' }));
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('1');
    expect(localStorage.getItem('playtest-zoom-v1')).toBeNull();
    unmount();
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('');
  });

  it('remembers the size across mounts', () => {
    localStorage.setItem('playtest-zoom-v1', '1.3');
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(document.body.style.getPropertyValue('--pt-zoom')).toBe('1.3');
  });
});

/**
 * A click on a permanent is not a tap when a mouse is driving (EDHPlay's
 * rule, user 2026-09-20) and, since 2026-09-21, not a selection either: it
 * says nothing at all, because the click is the start of a drag. Selecting is
 * the box or ⌘/ctrl-click, tapping is T or the card menu. A finger has
 * neither key nor right-click, so on a touch device a tap still taps, and
 * these tests are what keeps one device tier from quietly taking the other's
 * behaviour.
 */
describe('PlaytestBoard — what a click on a permanent means', () => {
  function onBattlefield() {
    return applyAction(seededState(), {
      type: 'MOVE_TO_BATTLEFIELD',
      cardId: 'card-0',
      x: 0.2,
      y: 0.3,
    });
  }

  it('with a mouse: a plain click neither taps the card nor selects it', () => {
    stubWidth(1440, true);
    render(
      <MemoryRouter>
        <PlaytestBoard state={onBattlefield()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card 0' }));
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'TAP', cardId: 'card-0' });
    expect(document.querySelector('.playtest-card--selected')).toBeNull();
  });

  it('with a mouse: ctrl-click selects the card, and T taps it', () => {
    stubWidth(1440, true);
    render(
      <MemoryRouter>
        <PlaytestBoard state={onBattlefield()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card 0' }), { ctrlKey: true });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'TAP', cardId: 'card-0' });
    expect(document.querySelector('.playtest-card--selected')).toBeTruthy();

    fireEvent.keyDown(window, { key: 't' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'TAP', cardId: 'card-0', tapped: true });
  });

  it('with a keyboard: Enter on a focused card selects it, since it can hold no modifier', () => {
    stubWidth(1440, true);
    render(
      <MemoryRouter>
        <PlaytestBoard state={onBattlefield()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Card 0' }), { key: 'Enter' });
    expect(document.querySelector('.playtest-card--selected')).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'TAP', cardId: 'card-0' });
  });

  it('with a finger: a tap still taps the permanent', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={onBattlefield()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card 0' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'TAP', cardId: 'card-0' });
  });
});

/**
 * Building a selection without a bulk-action bar (user, 2026-09-21): you drag
 * a box across bare felt the way you do at EDHPlay, the cards it touches wear
 * the selected ring, and the actions live in the menu you already right-click
 * for — which says how many cards it is about to act on.
 */
describe('PlaytestBoard — drag a box across the felt', () => {
  function twoLands() {
    let s = seededState();
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: 'card-0', x: 0.2, y: 0.3 });
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: 'card-1', x: 0.6, y: 0.3 });
    return s;
  }

  /** happy-dom lays nothing out, so the geometry the hit test reads is ours:
   *  the felt at the origin, card-0 inside the box the test drags, card-1
   *  well outside it. */
  function placeCards() {
    const felt = document.querySelector('.playtest-battlefield') as HTMLElement;
    const rect = (left: number, top: number, w: number, h: number) =>
      ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;
    felt.getBoundingClientRect = () => rect(0, 0, 1000, 600);
    const slots = document.querySelectorAll<HTMLElement>('[data-bf-card]');
    slots[0].getBoundingClientRect = () => rect(100, 100, 90, 126);
    slots[1].getBoundingClientRect = () => rect(600, 100, 90, 126);
    return felt;
  }

  function dragBox(felt: HTMLElement, to: { x: number; y: number }, init: object = {}) {
    fireEvent.pointerDown(felt, { clientX: 50, clientY: 50, button: 0, ...init });
    fireEvent.pointerMove(felt, { clientX: to.x, clientY: to.y });
    fireEvent.pointerUp(felt, { clientX: to.x, clientY: to.y });
    fireEvent.click(felt);
  }

  function selectedNames() {
    return [...document.querySelectorAll('.playtest-card--selected')].map((el) =>
      el.getAttribute('aria-label')
    );
  }

  beforeEach(() => {
    stubWidth(1440, true);
  });

  it('selects the cards the box touches and leaves the rest alone', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={twoLands()} />
      </MemoryRouter>
    );
    dragBox(placeCards(), { x: 300, y: 400 });
    expect(selectedNames()).toEqual(['Card 0']);
  });

  it('keeps the selection when the box is drawn with a modifier held', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={twoLands()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card 1' }), { ctrlKey: true });
    dragBox(placeCards(), { x: 300, y: 400 }, { shiftKey: true });
    expect(selectedNames().sort()).toEqual(['Card 0', 'Card 1']);
  });

  it('clears the selection on a click that never became a box', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={twoLands()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card 0' }), { ctrlKey: true });
    const felt = placeCards();
    fireEvent.pointerDown(felt, { clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerUp(felt, { clientX: 51, clientY: 50 });
    fireEvent.click(felt);
    expect(selectedNames()).toEqual([]);
  });

  it('right-clicking a selected card opens the selection menu, and Tap taps them all', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={twoLands()} />
      </MemoryRouter>
    );
    dragBox(placeCards(), { x: 800, y: 400 });
    expect(selectedNames().sort()).toEqual(['Card 0', 'Card 1']);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Card 0' }));
    expect(screen.getByText('2 cards selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Tap/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'TAP', cardId: 'card-0', tapped: true });
    expect(dispatch).toHaveBeenCalledWith({ type: 'TAP', cardId: 'card-1', tapped: true });
  });
});

// Drawn arrows (online only): W with one card selected arms an arrow from
// it, the next tap on a card is where it lands (sent as an `arrow` signal),
// and Shift+W clears the ones you drew.
describe('PlaytestBoard — arrows', () => {
  const sendSignal = vi.fn(async () => {});
  const banner = () => document.querySelector('.playtest-arrow-mode');

  function withTwoOnBattlefield() {
    let s = seededState();
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: 'card-0', x: 0.2, y: 0.3 });
    s = applyAction(s, { type: 'MOVE_TO_BATTLEFIELD', cardId: 'card-1', x: 0.6, y: 0.3 });
    return s;
  }

  beforeEach(() => {
    localStorage.clear();
    sendSignal.mockClear();
    usePlayStore.setState({ sendSignal, onlineArrows: [] });
  });

  it('W with one selected card arms the arrow, and the next card tap sends it', () => {
    onlineTable = seatedTable([opponent(1)]);
    render(
      <MemoryRouter>
        <PlaytestBoard state={withTwoOnBattlefield()} />
      </MemoryRouter>
    );
    // Nothing selected: W explains itself rather than arming.
    fireEvent.keyDown(window, { key: 'w' });
    expect(banner()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Card 0' }), { ctrlKey: true });
    fireEvent.keyDown(window, { key: 'w' });
    expect(banner()?.textContent).toContain('Arrow from Card 0');

    fireEvent.click(screen.getByRole('button', { name: 'Card 1' }));
    expect(sendSignal).toHaveBeenCalledWith({
      kind: 'arrow',
      op: 'add',
      fromSeat: 0,
      fromCardId: 'card-0',
      toSeat: 0,
      toCardId: 'card-1',
    });
    // The landing tap was the arrow's end, not a tap of the card.
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'TAP', cardId: 'card-1' });
    expect(banner()).toBeNull();
  });

  it('Esc cancels an armed arrow; clearing mine is a menu item, not a key', () => {
    onlineTable = seatedTable([opponent(1)]);
    usePlayStore.setState({
      onlineArrows: [{ id: '0:1', seat: 0, fromSeat: 0, fromCardId: 'card-0', toSeat: 1 }],
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={withTwoOnBattlefield()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card 0' }), { ctrlKey: true });
    fireEvent.keyDown(window, { key: 'w' });
    expect(banner()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(banner()).toBeNull();
    // A cancelled arrow sends nothing. The click that armed it DID ping the
    // card (every tap does), so this asserts on the arrow specifically
    // rather than on "nothing was sent at all".
    expect(sendSignal).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'arrow' }));

    // `arrows-clear` ships unbound (the EDHPlay map leaves it off a key), so
    // Shift+W is not the way in — the game menu is.
    fireEvent.keyDown(window, { key: 'W', shiftKey: true });
    expect(sendSignal).not.toHaveBeenCalledWith({ kind: 'arrow', op: 'clear' });

    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear my arrows (1)' }));
    expect(sendSignal).toHaveBeenCalledWith({ kind: 'arrow', op: 'clear' });
  });

  it('offline, W and the arrow menu item do nothing', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={withTwoOnBattlefield()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Card 0' }), { ctrlKey: true });
    fireEvent.keyDown(window, { key: 'w' });
    expect(banner()).toBeNull();
    expect(sendSignal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    expect(screen.queryByRole('button', { name: /Clear my arrows/ })).toBeNull();
  });
});

/**
 * A shared or public deck is never in the viewer's decks store — it is
 * adapted per page and parked on the playtest store as `externalDeck`. The
 * board used to look only in the decks store, so on every
 * `/d/:slug/playtest` visit it silently had no deck: the token picker's
 * "Deck tokens" grid came up empty and the hand's card previews were gone,
 * with no error to show for it. Found on the live site, not by a test,
 * which is exactly why this one exists.
 *
 * The assertion goes through the token picker on purpose: it is the surface
 * that consumes the deck's CARDS, so it fails if the board resolves no deck
 * — where a smoke-test "does the board render" would pass either way.
 */
describe("PlaytestBoard — a deck that is not the viewer's own", () => {
  const externalDeck = {
    id: 'public:goblin-storm',
    name: 'Goblin Storm',
    format: 'commander',
    source: 'manual',
    cards: [
      {
        slotId: 'pub-main-0',
        card: { id: 'sf-1', name: 'Dragon Fodder', type_line: 'Sorcery' },
        allocatedCopyId: null,
      },
    ],
    commander: { id: 'sf-c', name: 'Krenko, Mob Boss', type_line: 'Legendary Creature — Goblin' },
  } as never;

  it('hands the external deck’s cards to the token picker', async () => {
    usePlaytestStore.setState({ deckId: 'public:goblin-storm', externalDeck });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: 'n' });
    // `useDeckTokens` is mocked to name its token after the number of deck
    // cards it was handed: 1 mainboard + 1 commander. Before the fix it was
    // handed zero and the grid rendered its empty state instead.
    expect(await screen.findByText('deck-cards-2')).toBeTruthy();
    expect(screen.queryByText('This deck makes no tokens.')).toBeNull();
  });

  it('falls back to the empty state when there genuinely is no deck', async () => {
    usePlaytestStore.setState({ deckId: null, externalDeck: null });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: 'n' });
    expect(await screen.findByText('This deck makes no tokens.')).toBeTruthy();
  });
});

/**
 * Space is the biggest key on the keyboard and it used to be wired to
 * pass-turn ALONE — which exists only at an online table. In solo playtest,
 * where most goldfishing happens, pressing it did nothing at all. A key
 * that is dead in the common case is worse than an unbound one: it teaches
 * the player it is broken.
 *
 * So Space means "move the game on" in both modes, and the turn chip is the
 * pointer twin of the same action.
 */
describe('PlaytestBoard — Space moves the game on', () => {
  it('takes the next turn in solo', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'NEXT_TURN' });
  });

  it('passes the turn at a table when it is yours', () => {
    const tableDispatch = vi.fn();
    onlineTable = { ...seatedTable([opponent(1)]), dispatch: tableDispatch };
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(tableDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'pass-turn' }));
    // Never the solo action at a table — that would advance this seat's own
    // local turn counter behind the table's back.
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'NEXT_TURN' });
  });

  // The one case where it should still do nothing: somebody else is playing.
  it('does nothing at a table when it is not your turn', () => {
    const tableDispatch = vi.fn();
    onlineTable = { ...seatedTable([opponent(1)]), activeSeat: 1, dispatch: tableDispatch };
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(tableDispatch).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'NEXT_TURN' });
  });

  // The turn count IS the button; a separate "Next turn" control beside a
  // turn counter was two pieces of chrome saying one thing.
  it('makes the turn chip the pointer twin, with no separate turn button', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    // Exactly one control advances the turn, and it is the chip — not a
    // chip plus a button beside it saying the same thing.
    const advancers = screen.getAllByRole('button', { name: /Next turn/ });
    expect(advancers).toHaveLength(1);
    expect(advancers[0].className).toContain('playtest-turn-chip');
    fireEvent.click(advancers[0]);
    expect(dispatch).toHaveBeenCalledWith({ type: 'NEXT_TURN' });
  });
  // The hole the per-element handlers left: right-click was cancelled on cards
  // and on bare felt, so the native browser menu still popped on the zone
  // piles, the chrome and every gap between them — one gesture meaning two
  // different things a few pixels apart. `fireEvent` returns false when the
  // event was cancelled, which is exactly "no native menu here".
  it('keeps the native browser menu off the whole board, not just the cards', () => {
    const state = seededState();
    render(
      <MemoryRouter>
        <PlaytestBoard state={state} />
      </MemoryRouter>
    );

    const board = document.querySelector('.playtest-board')!;
    const pile = screen.getByText('Library (3)');
    const card = screen.getAllByText(state.zones.hand[0].name)[0];

    for (const target of [board, pile, card]) {
      expect(fireEvent.contextMenu(target)).toBe(false);
    }
  });
});

/**
 * Every reveal in the real thing is Everyone or Me — a two-option audience,
 * not a list of opponents. "Me" has to be private at the WIRE (see
 * `projectRevealedLibrary`), not merely filtered in an opponent's UI, so
 * these cover both the menu shape and the projection behind it.
 */
describe('PlaytestBoard — who a reveal is for', () => {
  beforeEach(() => {
    localStorage.clear();
    dispatch.mockClear();
    onlineTable = seatedTable([opponent(1), opponent(2)]);
  });

  function openLibraryMenu() {
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Draw a card\./ }), {
      clientX: 20,
      clientY: 20,
    });
  }

  function mount(state = seededState()) {
    render(
      <MemoryRouter>
        <PlaytestBoard state={state} />
      </MemoryRouter>
    );
  }

  it('offers Everyone and Me for the standing reveal, and marks which is on', () => {
    mount(applyAction(seededState(), { type: 'SET_LIBRARY_REVEAL', reveal: 'top-me' }));
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Play with top revealed/ }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'Me' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Everyone' }).getAttribute('aria-checked')
    ).toBe('false');

    // Switching audience is one step, not off-then-on.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Everyone' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LIBRARY_REVEAL', reveal: 'top' });
  });

  it('reveals the top card once as an event, not a mode', () => {
    mount();
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reveal top card/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Everyone' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'REVEAL_TOP_CARD' });
    // Not a standing reveal — nothing was switched on.
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_LIBRARY_REVEAL' })
    );
  });

  it('shows the top card to you alone when the audience is Me', () => {
    mount();
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reveal top card/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Me' }));
    expect(screen.getByText('Top of library')).toBeTruthy();
    // Showing yourself a card is not an action the table hears about.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('gives the whole-library reveal no Me — you can already read your own', () => {
    mount();
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reveal library/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Everyone' })).toBeTruthy();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Me' })).toBeNull();
  });

  it('turns the pile face up for either audience — Me is about them, not you', () => {
    for (const reveal of ['top', 'top-me'] as const) {
      const { unmount } = render(
        <MemoryRouter>
          <PlaytestBoard
            state={applyAction(seededState(), { type: 'SET_LIBRARY_REVEAL', reveal })}
          />
        </MemoryRouter>
      );
      expect(document.querySelector('.playtest-pile__back--library'), reveal).toBeNull();
      unmount();
    }
  });
});

/**
 * Every reveal in the real thing is Everyone or Me — a two-option audience,
 * not a list of opponents. "Me" has to be private at the WIRE (see
 * `projectRevealedLibrary`), not merely filtered in an opponent's UI, so
 * these cover both the menu shape and the projection behind it.
 */
describe('PlaytestBoard — who a reveal is for', () => {
  beforeEach(() => {
    localStorage.clear();
    dispatch.mockClear();
    onlineTable = seatedTable([opponent(1), opponent(2)]);
  });

  function openLibraryMenu() {
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Draw a card\./ }), {
      clientX: 20,
      clientY: 20,
    });
  }

  function mount(state = seededState()) {
    render(
      <MemoryRouter>
        <PlaytestBoard state={state} />
      </MemoryRouter>
    );
  }

  it('offers Everyone and Me for the standing reveal, and marks which is on', () => {
    mount(applyAction(seededState(), { type: 'SET_LIBRARY_REVEAL', reveal: 'top-me' }));
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Play with top revealed/ }));

    expect(screen.getByRole('menuitemcheckbox', { name: 'Me' }).getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Everyone' }).getAttribute('aria-checked')
    ).toBe('false');

    // Switching audience is one step, not off-then-on.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Everyone' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LIBRARY_REVEAL', reveal: 'top' });
  });

  it('reveals the top card once as an event, not a mode', () => {
    mount();
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reveal top card/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Everyone' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'REVEAL_TOP_CARD' });
    // Not a standing reveal — nothing was switched on.
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_LIBRARY_REVEAL' })
    );
  });

  it('shows the top card to you alone when the audience is Me', () => {
    mount();
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reveal top card/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Me' }));
    expect(screen.getByText('Top of library')).toBeTruthy();
    // Showing yourself a card is not an action the table hears about.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('gives the whole-library reveal no Me — you can already read your own', () => {
    mount();
    openLibraryMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Reveal library/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Everyone' })).toBeTruthy();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Me' })).toBeNull();
  });

  it('turns the pile face up for either audience — Me is about them, not you', () => {
    for (const reveal of ['top', 'top-me'] as const) {
      const { unmount } = render(
        <MemoryRouter>
          <PlaytestBoard
            state={applyAction(seededState(), { type: 'SET_LIBRARY_REVEAL', reveal })}
          />
        </MemoryRouter>
      );
      expect(document.querySelector('.playtest-pile__back--library'), reveal).toBeNull();
      unmount();
    }
  });
});

/**
 * The narrow tier reaches the same menu the table tier does, through the
 * zones drawer's kebab instead of a right-click, rendered as the shared
 * bottom sheet. The point of the hand-off is that there is ONE item list —
 * so what is asserted here is the ten rows arriving, not the plumbing.
 */
describe('PlaytestBoard — the phone gets the same zone menus', () => {
  beforeEach(() => {
    localStorage.clear();
    dispatch.mockClear();
    onlineTable = null;
    // Undo the desktop-forcing matchMedia from the outer beforeEach: this
    // block wants the board's narrow layout, which is what mounts the
    // zones drawer in place of the four piles.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  });

  function openLibrarySheet() {
    fireEvent.click(screen.getByRole('button', { name: 'Show other zones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Library actions' }));
  }

  it('opens the library menu as a sheet, with every row the table tier has', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibrarySheet();

    // The sheet variant, not the cursor-anchored popover.
    expect(screen.getByRole('dialog', { name: 'Library' })).toBeTruthy();
    for (const label of [
      /^Draw a card/,
      /^Draw several/,
      /^Move top cards to/,
      /^View/,
      /^Shuffle/,
      /^Select a random card/,
      /^Move all to/,
    ]) {
      expect(screen.getByRole('menuitem', { name: label }), String(label)).toBeTruthy();
    }
  });

  it('runs an action from the sheet', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibrarySheet();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Shuffle/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SHUFFLE_LIBRARY' });
  });

  it('drills into a submenu on a phone too', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    openLibrarySheet();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Move top cards to/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Exile face down' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exile 1 card face down' }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'MOVE_TOP_N',
      n: 1,
      to: 'exile',
      faceDown: true,
    });
  });

  it('gives the other three zones their menus as well', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show other zones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Graveyard actions' }));
    expect(screen.getByRole('dialog', { name: 'Graveyard' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Move all to/ })).toBeTruthy();
  });
});

/**
 * Partners put two commanders in the command zone at once, each accruing its
 * OWN tax. A pile that renders a single top card cannot say which one you
 * are casting, so the command zone is a row: both cards visible, both
 * clickable, a tax badge on each.
 */
describe('PlaytestBoard — the command zone with partners', () => {
  function withCommanders(names: string[], tax: Record<string, number> = {}) {
    const base = seededState();
    return {
      ...base,
      zones: {
        ...base.zones,
        command: names.map((n, i) => ({ id: `cmd-${i}`, name: n })),
      },
      commanderTax: tax,
    };
  }

  function mount(state: ReturnType<typeof withCommanders>) {
    render(
      <MemoryRouter>
        <PlaytestBoard state={state} />
      </MemoryRouter>
    );
  }

  it('shows both commanders, each castable by name', () => {
    mount(withCommanders(['Halana, Kessig Ranger', 'Alena, Kessig Trapper']));
    expect(screen.getByRole('button', { name: /^Cast Halana, Kessig Ranger/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Cast Alena, Kessig Trapper/ })).toBeTruthy();
    expect(document.querySelectorAll('.playtest-pile__commander').length).toBe(2);
  });

  it('casts the one you clicked, not the top of the pile', () => {
    mount(withCommanders(['Halana', 'Alena']));
    fireEvent.click(screen.getByRole('button', { name: /^Cast Alena/ }));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MOVE_TO_BATTLEFIELD', cardId: 'cmd-1' })
    );
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ cardId: 'cmd-0' }));
  });

  it('gives each commander its own tax, not one number for the zone', () => {
    // cmd-0 cast twice (+4), cmd-1 never (+0) — the reducer stores casts, the
    // badge doubles them (MTG 903.10).
    mount(withCommanders(['Halana', 'Alena'], { 'cmd-0': 2 }));
    const halana = screen.getByRole('button', { name: /^Cast Halana/ });
    const alena = screen.getByRole('button', { name: /^Cast Alena/ });
    expect(halana.getAttribute('aria-label')).toContain('tax +4');
    expect(alena.getAttribute('aria-label')).not.toContain('tax');
    // Both badges render, so the row cannot reflow when one goes from 0.
    expect(document.querySelectorAll('.playtest-pile__tax--own').length).toBe(2);
  });

  it('still works with a single commander', () => {
    mount(withCommanders(['Krenko, Mob Boss'], { 'cmd-0': 1 }));
    const btn = screen.getByRole('button', { name: /^Cast Krenko, Mob Boss/ });
    expect(btn.getAttribute('aria-label')).toContain('tax +2');
    fireEvent.click(btn);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MOVE_TO_BATTLEFIELD', cardId: 'cmd-0' })
    );
  });

  it('is an empty well with no commanders, not a labelled gap', () => {
    mount(withCommanders([]));
    expect(document.querySelectorAll('.playtest-pile__commander').length).toBe(0);
    expect(screen.getByRole('button', { name: /^View the command zone\./ })).toBeTruthy();
  });

  it('keeps its menu — the row does not swallow the right-click', () => {
    mount(withCommanders(['Halana', 'Alena']));
    fireEvent.contextMenu(screen.getByRole('button', { name: /^Cast Halana/ }), {
      clientX: 10,
      clientY: 10,
    });
    expect(screen.getByRole('menu', { name: 'Command zone' })).toBeTruthy();
  });
});
