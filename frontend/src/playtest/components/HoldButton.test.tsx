// @vitest-environment happy-dom
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/toasts';
import { createGameState, makePlayer } from '@/lib/game-state';
import type { GameRequest } from '@/lib/games-api';
import { HoldButton } from './HoldButton';

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
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Rival', startingLife: 40 }),
    ],
  });
}

function holdRequest(overrides: Partial<GameRequest> = {}): GameRequest {
  return {
    id: 'hold1',
    code: 'ABCD',
    kind: 'hold',
    payload: { summary: 'wants to respond' },
    requesterSeat: 0,
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
    raiseGameRequest: vi.fn(),
    cancelGameRequest: vi.fn(),
  });
});

describe('HoldButton', () => {
  it('renders nothing in solo playtest (no online game)', () => {
    usePlayStore.setState({ online: null });
    const { container } = render(<HoldButton />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when online but this device holds no seat', () => {
    useAuth.setState({ user: { id: 'someone-else', username: 'x', role: 'user' } });
    const { container } = render(<HoldButton />);
    expect(container.innerHTML).toBe('');
  });

  it('raises a hold with kind "hold" and an empty summary, then flips to release', async () => {
    const raised = holdRequest();
    usePlayStore.setState({ raiseGameRequest: vi.fn().mockResolvedValue(raised) });
    render(<HoldButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
      await Promise.resolve();
    });
    expect(usePlayStore.getState().raiseGameRequest).toHaveBeenCalledWith('hold', { summary: '' });

    // The real `raiseGameRequest` store action also writes the created
    // request into `onlineRequests` as a side effect (`applyServerRequest`)
    // — mocked away here, so drive the same store update it would perform.
    await act(async () => {
      usePlayStore.setState({ onlineRequests: { 0: raised } });
    });
    expect(screen.getByRole('button', { name: 'Holding — release' })).toBeTruthy();
  });

  it('release cancels this seat’s pending hold by id and flips back to Hold', async () => {
    const pending = holdRequest();
    usePlayStore.setState({
      raiseGameRequest: vi.fn().mockResolvedValue(pending),
      cancelGameRequest: vi.fn().mockResolvedValue({ ...pending, status: 'cancelled' }),
    });
    render(<HoldButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
      await Promise.resolve();
    });
    await act(async () => {
      usePlayStore.setState({ onlineRequests: { 0: pending } });
    });
    expect(screen.getByRole('button', { name: 'Holding — release' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Holding — release' }));
    expect(usePlayStore.getState().cancelGameRequest).toHaveBeenCalledWith('hold1');
    expect(screen.getByRole('button', { name: 'Hold' })).toBeTruthy();
  });

  it('surfaces a 409 already-pending error as a toast, the way the takeback flow does', async () => {
    const showSpy = vi.spyOn(toast, 'show');
    usePlayStore.setState({
      raiseGameRequest: vi
        .fn()
        .mockRejectedValue(new Error('A request is already pending for this seat.')),
    });
    render(<HoldButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
      await Promise.resolve();
    });

    expect(showSpy).toHaveBeenCalledWith({
      message: 'A request is already pending for this seat.',
      tone: 'warn',
    });
    // Still idle — the rejection never flipped the button to "release".
    expect(screen.getByRole('button', { name: 'Hold' })).toBeTruthy();
    showSpy.mockRestore();
  });
});
