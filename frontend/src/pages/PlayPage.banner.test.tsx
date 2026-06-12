// @vitest-environment happy-dom
/**
 * UX-323 — Join-code banner auto-hide.
 *
 * The banner should be visible only while online.status === 'lobby'.
 * Once the game transitions to 'active' (or 'finished'), the banner must not
 * render (it occludes counter chips mid-game).
 *
 * Strategy: mock the play-store selector so we can inject a minimal online
 * GameState with different status values without hitting the real backend.
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../lib/game-state';

// ── Minimal GameState factory ─────────────────────────────────────────────────

function makeOnlineGame(status: 'lobby' | 'active' | 'finished'): GameState {
  return {
    id: 'game_test',
    code: 'ABCD',
    mode: 'online',
    status,
    hostUserId: 'user_1',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    layout: 'pod',
    tapOrientation: 'horizontal',
    activeSeat: null,
    designations: { monarch: null, initiative: null },
    players: [
      {
        id: 'p1',
        userId: 'user_1',
        seat: 0,
        name: 'Alice',
        deckId: null,
        deckName: null,
        commander: null,
        colorIdentity: [],
        life: 40,
        commanderDamage: {},
        poison: 0,
        eliminated: false,
        isHost: true,
        connected: true,
        panelColorKey: null,
      },
    ],
    events: [],
    winnerSeat: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: status !== 'lobby' ? Date.now() : null,
    endedAt: status === 'finished' ? Date.now() : null,
    version: 1,
  };
}

// ── Store mocks ───────────────────────────────────────────────────────────────

// Mutable container so each test can change the injected online game
const mockState = {
  online: null as GameState | null,
};

const storeActions = {
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  startLocal: vi.fn(),
  rematchLocal: vi.fn(),
  dispatchLocal: vi.fn(),
  endLocal: vi.fn(),
  discardLocal: vi.fn(),
  hostOnline: vi.fn(async () => makeOnlineGame('lobby')),
  joinOnline: vi.fn(async () => makeOnlineGame('lobby')),
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
    local: null,
    online: mockState.online,
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
    {
      // PlayPage also calls usePlayStore.getState() directly in a useEffect
      getState: () => buildStoreSnapshot(),
    }
  ),
  aggregateDeckRecords: () => [],
  gameToRematch: (g: GameState) => g,
  recordToRematch: (r: unknown) => r,
}));

vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: object) => T): T => selector({ user: null, status: 'guest' }),
}));

vi.mock('../store/decks', () => ({
  useDecksStore: <T,>(selector: (s: object) => T): T => selector({ decks: [] }),
}));

// Stub GameBoard: render its banner prop (if any) so we can inspect it.
vi.mock('../components/play/GameBoard', () => ({
  GameBoard: ({ banner }: { banner?: React.ReactNode }) => (
    <div data-testid="game-board">{banner ?? null}</div>
  ),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

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
});

describe('UX-323 — Join-code banner auto-hide', () => {
  it('shows the join-code banner while the game is in lobby status', () => {
    mockState.online = makeOnlineGame('lobby');
    renderOnlineTab();

    expect(screen.getByText('ABCD')).toBeTruthy();
    expect(screen.getByText('Join code')).toBeTruthy();
  });

  it('hides the join-code banner once the game is active', () => {
    mockState.online = makeOnlineGame('active');
    renderOnlineTab();

    expect(screen.queryByText('Join code')).toBeNull();
    expect(screen.queryByText('ABCD')).toBeNull();
  });

  it('hides the join-code banner when the game is finished', () => {
    mockState.online = makeOnlineGame('finished');
    renderOnlineTab();

    expect(screen.queryByText('Join code')).toBeNull();
  });
});
