// @vitest-environment happy-dom
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { createGameState, makePlayer } from '@/lib/game-state';
import type { GameRequest } from '@/lib/games-api';
import { HoldBanner } from './HoldBanner';

function onlineGame() {
  return createGameState({
    id: 'game1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'me-id',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      makePlayer({
        id: 'me',
        userId: 'me-id',
        seat: 0,
        name: 'Me',
        startingLife: 40,
        isHost: true,
      }),
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Maya', startingLife: 40 }),
      makePlayer({ id: 'p2', userId: 'u2', seat: 2, name: 'Priya', startingLife: 40 }),
    ],
  });
}

function holdRequest(overrides: Partial<GameRequest> = {}): GameRequest {
  return {
    id: 'hold1',
    code: 'ABCD',
    kind: 'hold',
    payload: { summary: 'wants to respond' },
    requesterSeat: 1,
    approvals: {},
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 90_000,
    ...overrides,
  };
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'me-id', username: 'me', role: 'user' } });
  usePlayStore.setState({
    online: onlineGame(),
    onlineRequests: {},
    cancelGameRequest: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HoldBanner', () => {
  it('renders nothing when no holds are pending', () => {
    const { container } = render(<HoldBanner />);
    expect(container.innerHTML).toBe('');
  });

  it("renders another seat's hold with their name and seat color, no release control", () => {
    usePlayStore.setState({ onlineRequests: { 1: holdRequest() } });
    render(<HoldBanner />);
    const status = screen.getByRole('status');
    expect(within(status).getByText('Maya')).toBeTruthy();
    expect(status.textContent).toContain('wants to respond');
    expect(within(status).queryByRole('button', { name: 'Release' })).toBeNull();

    const row = status.querySelector('.playtest-hold-banner__row') as HTMLElement;
    expect(row.style.color).not.toBe('');
  });

  it('shows a release control for this seat’s own hold and cancels it by id', () => {
    usePlayStore.setState({ onlineRequests: { 0: holdRequest({ id: 'mine', requesterSeat: 0 }) } });
    render(<HoldBanner />);
    const release = screen.getByRole('button', { name: 'Release' });
    fireEvent.click(release);
    expect(usePlayStore.getState().cancelGameRequest).toHaveBeenCalledWith('mine');
  });

  it('ignores requests that are not a pending hold (e.g. a rewind, or a resolved hold)', () => {
    usePlayStore.setState({
      onlineRequests: {
        1: { ...holdRequest(), kind: 'rewind', payload: { steps: 1, summary: 'x' } },
        2: holdRequest({ id: 'resolved', requesterSeat: 2, status: 'cancelled' }),
      },
    });
    const { container } = render(<HoldBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('self-dismisses at expiresAt (+ grace) with no server frame', () => {
    vi.useFakeTimers();
    usePlayStore.setState({
      onlineRequests: { 1: holdRequest({ expiresAt: Date.now() + 1000 }) },
    });
    render(<HoldBanner />);
    expect(screen.getByRole('status')).toBeTruthy();

    // 1000ms to the deadline + the 2000ms shared grace window.
    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
