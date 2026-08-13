// @vitest-environment happy-dom
/**
 * mp-door — "Open your board" discoverability door.
 *
 * PlayPage's Online tab shows only a life counter; nothing on it ever
 * mentions that a card-table playtest view exists for the same game. This
 * covers the door that fixes that: it must route a seated player to their
 * own deck's playtest, prompt for a deck first when none is picked, show an
 * accurate "N of M boards open" count (the viewer's own seat is NOT
 * double-counted once their board has published), and recede once the
 * viewer's own board is already open.
 */
import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../lib/game-state';
import type { Deck } from '../store/decks';
import type { PublicBoard } from '../lib/playtest/projection';

// ── Minimal GameState / Deck factories ──────────────────────────────────────

function makePlayer(overrides: Partial<GameState['players'][number]> = {}) {
  return {
    id: 'p_default',
    userId: null,
    seat: 0,
    name: 'Player',
    deckId: null,
    deckName: null,
    commander: null,
    partner: null,
    colorIdentity: [],
    life: 40,
    commanderDamage: {},
    poison: 0,
    eliminated: false,
    isHost: false,
    connected: true,
    panelColorKey: null,
    ...overrides,
  };
}

function makeOnlineGame(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game_test',
    code: 'ABCD',
    mode: 'online',
    status: 'lobby',
    hostUserId: 'user_1',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    layout: 'pod',
    tapOrientation: 'horizontal',
    activeSeat: null,
    startingSeat: null,
    designations: { monarch: null, initiative: null },
    players: [
      makePlayer({ id: 'p1', userId: 'user_1', seat: 0, name: 'Alice', isHost: true }),
      makePlayer({ id: 'p2', userId: 'user_2', seat: 1, name: 'Bob' }),
    ],
    events: [],
    winnerSeat: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: null,
    endedAt: null,
    version: 1,
    ...overrides,
  } as GameState;
}

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'My Deck',
    format: 'commander',
    source: 'manual',
    commander: null,
    partnerCommander: null,
    commanderAllocatedCopyId: null,
    partnerCommanderAllocatedCopyId: null,
    cards: [],
    sideboard: [],
    considering: [],
    generationContext: null,
    color: '#888888',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as unknown as Deck;
}

function makeBoard(seat: number): PublicBoard {
  return {
    seat,
    turn: 1,
    life: 40,
    commanderTax: {},
    monarch: false,
    initiative: false,
    citysBlessing: false,
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
    handCount: 7,
    libraryCount: 92,
  };
}

// ── Store mocks ──────────────────────────────────────────────────────────────

const mockState = {
  online: null as GameState | null,
  local: null as GameState | null,
  onlineBoards: {} as Record<number, PublicBoard>,
  decks: [] as Deck[],
  authUserId: 'user_1' as string | null,
};

const storeActions = {
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  startLocal: vi.fn(),
  rematchLocal: vi.fn(),
  dispatchLocal: vi.fn(),
  endLocal: vi.fn(),
  discardLocal: vi.fn(),
  hostOnline: vi.fn(async () => makeOnlineGame()),
  joinOnline: vi.fn(async () => makeOnlineGame()),
  dispatchOnline: vi.fn(async () => {}),
  leaveOnline: vi.fn(async () => {}),
  refreshOnline: vi.fn(async () => {}),
  removeHistory: vi.fn(),
  setHaptics: vi.fn(),
  setPreferredLayout: vi.fn(),
  hideBoard: vi.fn(),
  showBoard: vi.fn(),
};

function buildStoreSnapshot() {
  return {
    local: mockState.local,
    online: mockState.online,
    onlineBoards: mockState.onlineBoards,
    history: [],
    boardVisible: true,
    onlineError: null,
    onlinePolling: false,
    hapticsEnabled: false,
    preferredLayouts: {},
    ...storeActions,
  };
}

vi.mock('../store/play', () => ({
  usePlayStore: Object.assign(
    <T,>(selector: (s: object) => T): T => selector(buildStoreSnapshot()),
    { getState: () => buildStoreSnapshot() }
  ),
  aggregateDeckRecords: () => [],
  gameToRematch: (g: GameState) => g,
  recordToRematch: (r: unknown) => r,
}));

vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: object) => T): T =>
    selector({
      user: mockState.authUserId ? { id: mockState.authUserId, username: 'Alice' } : null,
      status: mockState.authUserId ? 'authed' : 'guest',
    }),
}));

vi.mock('../store/decks', () => ({
  useDecksStore: <T,>(selector: (s: object) => T): T => selector({ decks: mockState.decks }),
}));

// GameBoard itself is heavy (rendering, timers, wake-lock…) and irrelevant
// here (local-only since T99) — stub it down to a marker div.
vi.mock('../components/play/GameBoard', () => ({
  GameBoard: () => <div data-testid="game-board" />,
}));

// OnlineGameView (the online surface since T99) is equally heavy and not
// under test here — the door + join-code banner now render as PlayPage
// siblings, not nested inside it, so a bare stub is enough.
vi.mock('../components/play/OnlineGameView', () => ({
  OnlineGameView: () => <div data-testid="online-game-view" />,
}));

import { PlayPage } from './PlayPage';

function renderOnlineTab() {
  return render(
    <MemoryRouter initialEntries={['/play?tab=online']}>
      <PlayPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockState.online = null;
  mockState.local = null;
  mockState.onlineBoards = {};
  mockState.decks = [];
  mockState.authUserId = 'user_1';
  storeActions.dispatchOnline.mockClear();
});

describe('Open-your-board door — visibility', () => {
  it('renders for a seated player and links to their own deck playtest', () => {
    mockState.online = makeOnlineGame({
      players: [
        makePlayer({
          id: 'p1',
          userId: 'user_1',
          seat: 0,
          name: 'Alice',
          isHost: true,
          deckId: 'deck-1',
          deckName: 'My Deck',
        }),
        makePlayer({ id: 'p2', userId: 'user_2', seat: 1, name: 'Bob' }),
      ],
    });
    renderOnlineTab();

    const link = screen.getByRole('link', { name: 'Open your board' });
    expect(link.getAttribute('href')).toBe('/decks/deck-1/playtest');
  });

  it('does not render for an active local (shared-device) game', () => {
    // The door is only rendered on PlayPage's online branch — a local game
    // never reaches it.
    mockState.local = makeOnlineGame({ mode: 'local', hostUserId: null });
    render(
      <MemoryRouter initialEntries={['/play?tab=local']}>
        <PlayPage />
      </MemoryRouter>
    );
    expect(screen.getByTestId('game-board')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /open your board/i })).toBeNull();
    expect(screen.queryByText(/boards open/)).toBeNull();
  });

  it('does not render when the viewer holds no seat in the online game', () => {
    mockState.authUserId = 'user_9'; // not a participant in the game below
    mockState.online = makeOnlineGame();
    renderOnlineTab();

    expect(screen.queryByRole('link', { name: /open your board/i })).toBeNull();
    expect(screen.queryByText(/boards open/)).toBeNull();
  });
});

describe('Open-your-board door — no deck picked', () => {
  it('prompts to pick a deck instead of linking to a broken URL', () => {
    mockState.decks = [makeDeck({ id: 'deck-1', name: 'My Deck' })];
    mockState.online = makeOnlineGame({
      players: [
        makePlayer({ id: 'p1', userId: 'user_1', seat: 0, name: 'Alice', isHost: true }),
        makePlayer({ id: 'p2', userId: 'user_2', seat: 1, name: 'Bob' }),
      ],
    });
    renderOnlineTab();

    expect(screen.getByText('Pick a deck to open your board')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /open your board/i })).toBeNull();

    // The reused SeatDeck affordance — same "+ Deck" control the join form uses.
    fireEvent.click(screen.getByRole('button', { name: 'Add deck' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deck' })); // SelectMenu trigger
    fireEvent.click(screen.getByRole('option', { name: 'My Deck' }));

    expect(storeActions.dispatchOnline).toHaveBeenCalledWith({
      type: 'update-player',
      seat: 0,
      patch: {
        deckId: 'deck-1',
        deckName: 'My Deck',
        commander: null,
        partner: null,
        colorIdentity: [],
      },
    });
  });
});

describe('Open-your-board door — boards-open count', () => {
  it('counts the local seat exactly once once its own board has published', () => {
    // The server fans a published board out to every subscriber, including
    // the publisher — so the viewer's own seat (0) legitimately appears as
    // a key in onlineBoards. The count must not add a separate +1 for "me".
    mockState.onlineBoards = { 0: makeBoard(0) };
    mockState.online = makeOnlineGame({
      status: 'active',
      players: [
        makePlayer({
          id: 'p1',
          userId: 'user_1',
          seat: 0,
          name: 'Alice',
          isHost: true,
          deckId: 'deck-1',
          deckName: 'My Deck',
        }),
        makePlayer({ id: 'p2', userId: 'user_2', seat: 1, name: 'Bob' }),
        makePlayer({ id: 'p3', userId: 'user_3', seat: 2, name: 'Carol' }),
      ],
    });
    renderOnlineTab();

    expect(screen.getByText('1 of 3 boards open')).toBeTruthy();
  });

  it('counts every published seat, viewer included', () => {
    mockState.onlineBoards = { 0: makeBoard(0), 1: makeBoard(1) };
    mockState.online = makeOnlineGame({
      status: 'active',
      players: [
        makePlayer({
          id: 'p1',
          userId: 'user_1',
          seat: 0,
          name: 'Alice',
          isHost: true,
          deckId: 'deck-1',
          deckName: 'My Deck',
        }),
        makePlayer({ id: 'p2', userId: 'user_2', seat: 1, name: 'Bob' }),
        makePlayer({ id: 'p3', userId: 'user_3', seat: 2, name: 'Carol' }),
      ],
    });
    renderOnlineTab();

    expect(screen.getByText('2 of 3 boards open')).toBeTruthy();
  });
});

describe('Open-your-board door — nudge recedes once open', () => {
  const players = [
    makePlayer({
      id: 'p1',
      userId: 'user_1',
      seat: 0,
      name: 'Alice',
      isHost: true,
      deckId: 'deck-1',
      deckName: 'My Deck',
    }),
    makePlayer({ id: 'p2', userId: 'user_2', seat: 1, name: 'Bob' }),
  ];

  it('is prominent (primary CTA) when the game is active and the board is not open', () => {
    mockState.online = makeOnlineGame({ status: 'active', players });
    renderOnlineTab();

    const link = screen.getByRole('link', { name: 'Open your board' });
    expect(link.classList.contains('btn-primary')).toBe(true);
  });

  it('recedes once the viewer has opened their own board', () => {
    mockState.onlineBoards = { 0: makeBoard(0) };
    mockState.online = makeOnlineGame({ status: 'active', players });
    renderOnlineTab();

    const link = screen.getByRole('link', { name: 'Back to your board' });
    expect(link.classList.contains('btn-primary')).toBe(false);
    expect(screen.queryByRole('link', { name: 'Open your board' })).toBeNull();
  });

  it('is not urgent in the lobby even without a board open', () => {
    mockState.online = makeOnlineGame({ status: 'lobby', players });
    renderOnlineTab();

    const link = screen.getByRole('link', { name: 'Open your board' });
    expect(link.classList.contains('btn-primary')).toBe(false);
  });
});
