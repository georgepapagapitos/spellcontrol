// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
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
    expect(menu.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.click(menu);
    for (const label of [
      'Back to Krenko',
      'Stats',
      'Log',
      'Keyboard shortcuts',
      'Table settings',
      'Reset',
    ]) {
      expect(screen.getByRole('menuitem', { name: label }), label).toBeTruthy();
    }
    // Library actions moved onto the library pile, and the set-and-forget
    // preferences behind "Table settings" — the menu is actions now.
    for (const gone of ['Shuffle', 'Mulligan', 'Top cards', 'Resistance: Off']) {
      expect(screen.queryByRole('menuitem', { name: gone }), gone).toBeNull();
    }
  });

  it('the library pile carries its own actions: Draw, Shuffle and Top cards', () => {
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /Draw/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Library actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Shuffle' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SHUFFLE_LIBRARY' });
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
    // The library pile's Draw prints the live key, not the default — it is
    // the only Draw control on the felt now that the table menu dropped it.
    expect(screen.getByRole('button', { name: /Draw/ }).textContent).toContain('J');
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Table settings' }));
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear my arrows (1)' }));
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
    expect(screen.queryByRole('menuitem', { name: /Clear my arrows/ })).toBeNull();
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
