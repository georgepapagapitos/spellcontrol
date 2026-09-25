// @vitest-environment happy-dom
/**
 * No `@testing-library/jest-dom` in this repo — assertions use plain
 * vitest/chai matchers, not `.toBeInTheDocument()`/`.toHaveAccessibleName()`.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { applyAction, createGameState, makePlayer, type GameState } from '@/lib/game-state';
import { TableFinishedBanner } from './TableFinishedBanner';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

// leaveOnline() calls the games HTTP API best-effort — mock it so "Leave
// table" doesn't fire a real network request in the test.
vi.mock('@/lib/games-api', () => ({
  leaveGame: vi.fn().mockResolvedValue(undefined),
}));

function onlineGame(overrides: Partial<GameState> = {}): GameState {
  const g = createGameState({
    id: 'game1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'host-id',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    mulliganType: 'commander' as const,
    turnTimerEnabled: false,
    poisonEnabled: false,
    players: [
      makePlayer({
        id: 'host-id',
        userId: 'host-id',
        seat: 0,
        name: 'Host',
        startingLife: 40,
        isHost: true,
        colorIdentity: ['U'],
      }),
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Rival', startingLife: 40 }),
    ],
  });
  return { ...applyAction(g, { type: 'start' }), ...overrides };
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <TableFinishedBanner />
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigateMock.mockClear();
  usePlayStore.setState({ online: null });
});

describe('TableFinishedBanner', () => {
  it('renders nothing with no linked online game (solo goldfish)', () => {
    usePlayStore.setState({ online: null });
    renderBanner();
    expect(document.body.querySelector('.playtest-finished-banner')).toBeNull();
  });

  it('renders nothing while the table is still live', () => {
    usePlayStore.setState({ online: onlineGame() });
    renderBanner();
    expect(document.body.querySelector('.playtest-finished-banner')).toBeNull();
  });

  it('shows the winner and a way out once the table finishes', () => {
    const active = onlineGame();
    usePlayStore.setState({ online: active });
    const { rerender } = renderBanner();
    act(() => {
      usePlayStore.setState({ online: applyAction(active, { type: 'end', winnerSeat: 1 }) });
    });
    rerender(
      <MemoryRouter>
        <TableFinishedBanner />
      </MemoryRouter>
    );

    const banner = document.body.querySelector('.playtest-finished-banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('Rival wins the game');
    expect(screen.getByRole('button', { name: 'Leave table' })).not.toBeNull();
  });

  it('shows a draw as "Game over", never a fabricated winner', () => {
    const active = onlineGame();
    usePlayStore.setState({ online: active });
    const { rerender } = renderBanner();
    act(() => {
      usePlayStore.setState({ online: applyAction(active, { type: 'end', winnerSeat: null }) });
    });
    rerender(
      <MemoryRouter>
        <TableFinishedBanner />
      </MemoryRouter>
    );

    expect(document.body.querySelector('.playtest-finished-banner')!.textContent).toContain(
      'Game over. No winner.'
    );
  });

  it('renders on mount straight into an already-finished game — the reload case', () => {
    const active = onlineGame();
    const finished = applyAction(active, { type: 'end', winnerSeat: 0 });
    usePlayStore.setState({ online: finished });
    renderBanner();

    expect(document.body.querySelector('.playtest-finished-banner')).not.toBeNull();
    expect(document.body.querySelector('.playtest-finished-banner')!.textContent).toContain(
      'Host wins the game'
    );
  });

  it('"Leave table" leaves the session and navigates to /play', async () => {
    const active = onlineGame();
    const finished = applyAction(active, { type: 'end', winnerSeat: 1 });
    usePlayStore.setState({ online: finished });
    renderBanner();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leave table' }));
    });

    expect(navigateMock).toHaveBeenCalledWith('/play');
    expect(usePlayStore.getState().online).toBeNull();
  });

  it('is non-modal: no aria-modal, no backdrop', () => {
    const active = onlineGame();
    usePlayStore.setState({ online: applyAction(active, { type: 'end', winnerSeat: 1 }) });
    renderBanner();

    expect(document.body.querySelector('[aria-modal]')).toBeNull();
  });
});

describe('TableFinishedBanner placement', () => {
  // At the very top of the viewport it sat over an opponent's life total
  // (the E351 screenshots, 2026-09-24). It docks where the hold banner does,
  // under the seat headers, and the two must not drift apart.
  it('docks at the hold banner’s top, under the seat headers', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const top = (file: string, selector: string) => {
      const css = readFileSync(join(here, file), 'utf8');
      const start = css.indexOf(`${selector} {`);
      const body = start < 0 ? '' : css.slice(start, css.indexOf('}', start));
      return /(?:^|\n)\s*top:\s*([^;]+);/.exec(body)?.[1].trim();
    };
    const hold = top('HoldBanner.css', '.playtest-hold-banner');
    expect(hold).toBeTruthy();
    expect(top('TableFinishedBanner.css', '.playtest-finished-banner')).toBe(hold);
  });
});
