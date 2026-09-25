// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createPlaytestState } from '@/lib/playtest';
import type { GameState } from '@/lib/game-state';
import { usePlayStore } from '@/store/play';
import { usePlaytestStore } from '../store';
import { buildTestHorde } from '../lib/horde-solo.fixtures';
import type { OnlineTable } from '../hooks/use-online-table';
import type { OnlineHordeResult, OnlineHordeTeam } from '../hooks/use-online-horde';
import type { OpponentSeat } from './OpponentRail';
import { PlaytestBoard } from './PlaytestBoard';

/**
 * A horde at an online table (E387 online co-op, lane F2). Mocks BOTH
 * `useOnlineTable` and `useOnlineHorde` wholesale — the same seam
 * PlaytestBoard.test.tsx mocks `useOnlineTable` alone at, extended with the
 * horde-specific one lane F1 built. `onlineHorde` null is the "seated at a
 * non-horde online table" and "solo" cases; PlaytestBoard.test.tsx already
 * covers both, so this file is horde-only.
 */
let onlineTable: OnlineTable | null = null;
let onlineHorde: OnlineHordeResult | null = null;
vi.mock('../hooks/use-online-table', () => ({
  useOnlineTable: () => onlineTable,
}));
vi.mock('../hooks/use-online-horde', () => ({
  useOnlineHorde: () => onlineHorde,
}));
vi.mock('@/components/deck/use-deck-tokens', () => ({
  useDeckTokens: () => [],
}));
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  searchTokens: async () => [],
  resolveTokenOption: async () => null,
}));
vi.mock('@/lib/card-thumbs', () => ({
  useCardThumb: (name?: string) => (name ? `https://cards.example/${name}.jpg` : undefined),
  cachedCardThumb: (name: string) => `https://cards.example/${name}.jpg`,
}));

const dispatch = vi.fn();

function seededState() {
  return createPlaytestState({
    library: Array.from({ length: 10 }, (_, i) => ({ id: `card-${i}`, name: `Card ${i}` })),
    openingHandSize: 7,
  });
}

function opponent(seat: number, name: string): OpponentSeat {
  return {
    name,
    board: {
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
      libraryCount: 90,
    },
  };
}

function seatedTable(opponents: OpponentSeat[], overrides: Partial<OnlineTable> = {}): OnlineTable {
  return {
    activeSeat: null,
    opponents,
    mySeat: 0,
    isHost: false,
    me: { seat: 0, name: 'Dev', life: 40 } as OnlineTable['me'],
    players: [
      { seat: 0, name: 'Dev', life: 40, connected: true } as OnlineTable['players'][number],
      ...opponents.map(
        (o) =>
          ({
            seat: o.board.seat,
            name: o.name,
            life: o.board.life,
            connected: true,
          }) as OnlineTable['players'][number]
      ),
    ],
    phase: undefined,
    poisonEnabled: false,
    commanderDamageEnabled: false,
    mulliganType: 'commander' as const,
    turnTimerEnabled: false,
    turnStartedAt: null,
    designations: { monarch: null, initiative: null },
    dispatch: vi.fn(),
    ...overrides,
  };
}

function team(overrides: Partial<OnlineHordeTeam> = {}): OnlineHordeTeam {
  return {
    phase: 'survivors',
    survivorTurn: 1,
    setupTurns: 3,
    hordeTurn: 0,
    done: [],
    iAmDone: false,
    waitingOn: [],
    inSetup: true,
    ...overrides,
  };
}

function buildOnlineHorde(overrides: Partial<OnlineHordeResult> = {}): OnlineHordeResult {
  return {
    status: 'ready',
    error: null,
    retry: vi.fn(),
    replay: { view: buildTestHorde(), outcome: null, lastDamage: null, lastArrivals: null },
    team: team(),
    actions: {
      take: vi.fn(),
      damage: vi.fn(),
      move: vi.fn(),
      confirmReveal: vi.fn(),
      clearDamageResult: vi.fn(),
      retryLoad: vi.fn(),
    },
    markDone: vi.fn(),
    startWithout: vi.fn(),
    undoLast: vi.fn(),
    lastStepLabel: null,
    damageResult: null,
    ...overrides,
  };
}

// Reduced motion always on so a sheet's `useSheetExit` (Confirm/Done/Leave)
// closes synchronously — happy-dom never fires `animationend`, the same fix
// PlaytestBoard.test.tsx's solo-Horde describe block applies.
function stubWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      if (query.includes('prefers-reduced-motion')) {
        return {
          matches: true,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        };
      }
      const min = /min-width:\s*(\d+)px/.exec(query);
      const max = /max-width:\s*(\d+)px/.exec(query);
      const matches =
        (!min || width >= Number(min[1])) &&
        (!max || width <= Number(max[1])) &&
        !/hover|pointer|orientation/.test(query);
      return { matches, media: query, addEventListener: () => {}, removeEventListener: () => {} };
    },
  });
}

function fakeOnline(overrides: Partial<GameState> = {}): GameState {
  return {
    status: 'active',
    format: 'horde',
    players: [],
    winnerSeat: null,
    ...overrides,
  } as unknown as GameState;
}

beforeEach(() => {
  dispatch.mockReset();
  onlineTable = null;
  onlineHorde = null;
  usePlaytestStore.setState({ phase: 'playing', dispatch });
  usePlayStore.setState({ online: null });
  stubWidth(1280); // desktop by default
});

describe('PlaytestBoard — a horde at an online table: layout', () => {
  it('forces the rail and never the seat grid, with the horde-rail layout class', () => {
    onlineTable = seatedTable([opponent(1, 'Maya'), opponent(2, 'Theo')]);
    onlineHorde = buildOnlineHorde();
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    const main = document.querySelector('.playtest-main');
    expect(main?.classList.contains('playtest-main--horde')).toBe(true);
    expect(main?.classList.contains('playtest-main--horde-rail')).toBe(true);
    expect(main?.classList.contains('playtest-main--grid')).toBe(false);
    expect(document.querySelector('.opponent-rail')).toBeTruthy();
    expect(document.querySelector('.horde-half')).toBeTruthy();
  });

  it('never offers the seat-grid toggle row (gridFits is forced off, same degrade as a 5-seat pod)', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde();
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    expect(screen.queryByRole('button', { name: /Show the seat grid/ })).toBeNull();
  });

  it('renders the phone band instead of the half when narrow', () => {
    stubWidth(390);
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde();
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(document.querySelector('.horde-band')).toBeTruthy();
    expect(document.querySelector('.horde-half')).toBeNull();
  });

  it('a non-horde online table renders the seat grid exactly as before', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = null;
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    const main = document.querySelector('.playtest-main');
    expect(main?.classList.contains('playtest-main--horde')).toBe(false);
    expect(main?.classList.contains('playtest-main--horde-rail')).toBe(false);
    expect(main?.classList.contains('playtest-main--grid')).toBe(true);
    expect(document.querySelector('.horde-half')).toBeNull();
    expect(screen.getByRole('button', { name: /^Pass the turn, turn 1/ })).toBeTruthy();
  });
});

describe('PlaytestBoard — a horde at an online table: the team-turn chip', () => {
  it('offers a "Team turn N / Done" button while not done, and marks done on click', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ team: team({ survivorTurn: 2, iAmDone: false }) });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Team turn 2')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    fireEvent.click(screen.getByText('Done'));
    expect(onlineHorde!.markDone).toHaveBeenCalledWith(true);
  });

  it('shortens the label to "Team N" narrow', () => {
    stubWidth(390);
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ team: team({ survivorTurn: 2, iAmDone: false }) });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Team 2')).toBeTruthy();
  });

  it('shows "Waiting for Maya" plus "Start without Maya" once done, and un-marks on a second press', () => {
    onlineTable = seatedTable([opponent(1, 'Maya'), opponent(2, 'Theo')]);
    onlineHorde = buildOnlineHorde({ team: team({ iAmDone: true, waitingOn: ['Maya'] }) });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Waiting for Maya')).toBeTruthy();
    const go = screen.getByRole('button', { name: 'Start without Maya' });
    fireEvent.click(go);
    expect(onlineHorde!.startWithout).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Waiting for Maya'));
    expect(onlineHorde!.markDone).toHaveBeenCalledWith(false);
  });

  it('reads "Team done" with no Start-without button when nobody is left to wait on', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ team: team({ iAmDone: true, waitingOn: [] }) });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Team done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start without/ })).toBeNull();
  });

  it('shows "Go now" in the band instead of the desktop Start-without button when narrow', () => {
    stubWidth(390);
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ team: team({ iAmDone: true, waitingOn: ['Maya'] }) });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    // The desktop corner button never renders narrow; the band's own
    // extraAction takes over instead — same intent, full sentence still in
    // its aria-label for a screen-reader user, short "Go now" visually.
    expect(document.querySelector('.playtest-team-turn__go')).toBeNull();
    const goNow = screen.getByRole('button', { name: 'Start without Maya' });
    expect(goNow.textContent).toBe('Go now');
    fireEvent.click(goNow);
    expect(onlineHorde!.startWithout).toHaveBeenCalledTimes(1);
  });

  it('reads "The horde\'s turn" during reveal/combat, narrow shortens to "Horde"', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ team: team({ phase: 'combat', inSetup: false }) });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText("The horde's turn")).toBeTruthy();
  });

  it('hides the PhaseChip at a horde table (it would otherwise offer to start the phase clock, since this seat is on turn)', () => {
    // activeSeat === mySeat is PhaseChip's own condition for rendering
    // anything at all when no clock is running yet (`isActiveOwner`).
    onlineTable = seatedTable([opponent(1, 'Maya')], { activeSeat: 0 });
    onlineHorde = buildOnlineHorde();
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(document.querySelector('.ogv-phase-start')).toBeNull();
    expect(document.querySelector('.ogv-phase-chip')).toBeNull();
  });

  it('Space toggles Done instead of passing a turn', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ team: team({ iAmDone: false }) });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: ' ' });
    expect(onlineHorde!.markDone).toHaveBeenCalledWith(true);
  });
});

describe('PlaytestBoard — a horde at an online table: reveal and combat', () => {
  it('confirms the reveal through actions.confirmReveal', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    const view = buildTestHorde({
      phase: 'reveal',
      pendingReveal: {
        revealed: [{ id: 'z1', name: 'Zombie' }],
        toBattlefield: [],
        toResolve: [],
        waveEndId: 'z1',
      },
    });
    onlineHorde = buildOnlineHorde({
      team: team({ phase: 'reveal', inSetup: false }),
      replay: { view, outcome: null, lastDamage: null, lastArrivals: null },
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onlineHorde!.actions.confirmReveal).toHaveBeenCalledTimes(1);
  });

  it('says there is nothing left to reveal on an empty wave', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    const view = buildTestHorde({
      phase: 'reveal',
      pendingReveal: { revealed: [], toBattlefield: [], toResolve: [], waveEndId: null },
    });
    onlineHorde = buildOnlineHorde({
      team: team({ phase: 'reveal', inSetup: false }),
      replay: { view, outcome: null, lastDamage: null, lastArrivals: null },
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('The horde has nothing left to reveal.')).toBeTruthy();
  });

  it('takes the combat total through the desktop banner', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    const view = buildTestHorde({
      phase: 'combat',
      pendingAttack: {
        attackers: 1,
        power: 5,
        groups: [{ name: 'Zombie', power: '5', toughness: '5', count: 1 }],
      },
    });
    onlineHorde = buildOnlineHorde({
      team: team({ phase: 'combat', inSetup: false }),
      replay: { view, outcome: null, lastDamage: null, lastArrivals: null },
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take 5' }));
    expect(onlineHorde!.actions.take).toHaveBeenCalledWith(5);
  });
});

describe('PlaytestBoard — a horde at an online table: load states', () => {
  it('shows the skew message and a Reload action', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ status: 'skew', replay: null });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(
      screen.getByText(
        "This table's horde comes from a newer version of the app. Reload to join in."
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('shows a loading line while the deck is loading', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ status: 'loading', replay: null });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('Loading the horde…')).toBeTruthy();
  });

  it('shows an error with Try again', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({
      status: 'error',
      error: "Couldn't load the horde.",
      replay: null,
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText("Couldn't load the horde.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onlineHorde!.actions.retryLoad).toHaveBeenCalledTimes(1);
  });
});

describe('PlaytestBoard — a horde at an online table: the rail', () => {
  it('tags each teammate Playing, Done or Offline', () => {
    onlineTable = seatedTable([opponent(1, 'Maya'), opponent(2, 'Theo'), opponent(3, 'Ren')], {
      players: [
        { seat: 0, name: 'Dev', life: 40, connected: true } as OnlineTable['players'][number],
        { seat: 1, name: 'Maya', life: 40, connected: true } as OnlineTable['players'][number],
        { seat: 2, name: 'Theo', life: 40, connected: true } as OnlineTable['players'][number],
        { seat: 3, name: 'Ren', life: 40, connected: false } as OnlineTable['players'][number],
      ],
    });
    onlineHorde = buildOnlineHorde({ team: team({ done: [2] }) });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    const rail = document.querySelector<HTMLElement>('.opponent-rail')!;
    expect(within(rail).getByText('Playing')).toBeTruthy();
    expect(within(rail).getByText('✓ Done')).toBeTruthy();
    expect(within(rail).getByText('Offline')).toBeTruthy();
  });
});

describe('PlaytestBoard — a horde at an online table: undo', () => {
  it('offers an Undo row with the last step as its note, disabled with no steps', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ lastStepLabel: null });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    const row = screen.getByRole('button', {
      name: /Undo the horde's last step/,
    }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
  });

  it('undoes the last step through undoLast when enabled', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    onlineHorde = buildOnlineHorde({ lastStepLabel: '8 damage to the horde' });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Game menu' }));
    const row = screen.getByRole('button', {
      name: /Undo the horde's last step/,
    }) as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    fireEvent.click(row);
    expect(onlineHorde!.undoLast).toHaveBeenCalledTimes(1);
  });
});

describe('PlaytestBoard — a horde at an online table: the end', () => {
  it('host: Rematch dispatches reset, Leave table leaves the table', async () => {
    const tableDispatch = vi.fn();
    onlineTable = seatedTable([opponent(1, 'Maya')], { isHost: true, dispatch: tableDispatch });
    const view = buildTestHorde({ phase: 'ended', outcome: 'won' });
    onlineHorde = buildOnlineHorde({
      replay: { view, outcome: 'won', lastDamage: null, lastArrivals: null },
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.getByText('The horde is gone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }));
    expect(tableDispatch).toHaveBeenCalledWith({ type: 'reset' });
    expect(screen.getByRole('button', { name: 'Leave table' })).toBeTruthy();
  });

  it('joiner: no Rematch button, just Leave table and a hint', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')], { isHost: false });
    const view = buildTestHorde({ phase: 'ended', outcome: 'lost' });
    onlineHorde = buildOnlineHorde({
      replay: { view, outcome: 'lost', lastDamage: null, lastArrivals: null },
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: 'Rematch' })).toBeNull();
    expect(screen.getByText('The host can start a rematch.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave table' })).toBeTruthy();
  });

  it('suppresses TableFinishedBanner at a horde table', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    const view = buildTestHorde({ phase: 'ended', outcome: 'won' });
    onlineHorde = buildOnlineHorde({
      replay: { view, outcome: 'won', lastDamage: null, lastArrivals: null },
    });
    usePlayStore.setState({
      online: fakeOnline({ status: 'finished', format: 'horde', players: [] }),
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    expect(document.querySelector('.playtest-finished-banner')).toBeNull();
    // The Horde end sheet is the one ending UI.
    expect(screen.getByText('The horde is gone')).toBeTruthy();
  });

  it('suppresses the win-ceremony moment at a horde table (edge-triggered: mounts active, then finishes)', () => {
    onlineTable = seatedTable([opponent(1, 'Maya')]);
    const view = buildTestHorde({ phase: 'ended', outcome: 'won' });
    onlineHorde = buildOnlineHorde({
      replay: { view, outcome: 'won', lastDamage: null, lastArrivals: null },
    });
    usePlayStore.setState({
      online: fakeOnline({ status: 'active', format: 'horde', players: [] }),
    });
    render(
      <MemoryRouter>
        <PlaytestBoard state={seededState()} />
      </MemoryRouter>
    );
    act(() => {
      usePlayStore.setState({
        online: fakeOnline({ status: 'finished', format: 'horde', players: [] }),
      });
    });
    expect(document.querySelector('.table-win-backdrop')).toBeNull();
  });
});
