// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoomBrowser } from './RoomBrowser';
import { listGames, type GameListing } from '../../lib/games-api';
import { pending } from '../../test/pending';

vi.mock('../../lib/games-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/games-api')>();
  return { ...actual, listGames: vi.fn() };
});

const mockListGames = vi.mocked(listGames);

function row(overrides: Partial<GameListing> = {}): GameListing {
  return {
    code: 'ABCD',
    name: 'Bracket 3 chill',
    format: 'commander',
    status: 'lobby',
    seated: 2,
    max: 8,
    joinable: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockListGames.mockReset();
});

describe('RoomBrowser', () => {
  it('shows a loading state before the list resolves', () => {
    mockListGames.mockReturnValue(pending<GameListing[]>([]));
    render(<RoomBrowser onJoin={vi.fn()} onWatch={vi.fn()} onHostInstead={vi.fn()} />);
    expect(screen.getByText(/loading public games/i)).toBeTruthy();
  });

  it('shows the empty state and offers to host', async () => {
    mockListGames.mockResolvedValue([]);
    const onHostInstead = vi.fn();
    render(<RoomBrowser onJoin={vi.fn()} onWatch={vi.fn()} onHostInstead={onHostInstead} />);
    expect(await screen.findByText('No public games right now.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Host a table' }));
    expect(onHostInstead).toHaveBeenCalledTimes(1);
  });

  it('shows a retry-capable error state on failure', async () => {
    mockListGames.mockRejectedValueOnce(new Error('Could not reach the games list.'));
    mockListGames.mockResolvedValueOnce([row()]);
    render(<RoomBrowser onJoin={vi.fn()} onWatch={vi.fn()} onHostInstead={vi.fn()} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not reach the games list.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Bracket 3 chill')).toBeTruthy();
  });

  it('joins a joinable lobby row', async () => {
    mockListGames.mockResolvedValue([row()]);
    const onJoin = vi.fn();
    render(<RoomBrowser onJoin={onJoin} onWatch={vi.fn()} onHostInstead={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Join' }));
    expect(onJoin).toHaveBeenCalledWith('ABCD');
  });

  it('marks a full lobby as not joinable', async () => {
    mockListGames.mockResolvedValue([row({ joinable: false, seated: 8 })]);
    render(<RoomBrowser onJoin={vi.fn()} onWatch={vi.fn()} onHostInstead={vi.fn()} />);
    const full = (await screen.findByRole('button', { name: 'Full' })) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
  });

  it('offers Spectate and a started marker for an active game', async () => {
    mockListGames.mockResolvedValue([row({ status: 'active', joinable: false })]);
    const onWatch = vi.fn();
    render(<RoomBrowser onJoin={vi.fn()} onWatch={onWatch} onHostInstead={vi.fn()} />);
    expect(await screen.findByText('Game started')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Spectate' }));
    expect(onWatch).toHaveBeenCalledWith('ABCD');
  });

  it('shows format and seat counts in the row meta', async () => {
    mockListGames.mockResolvedValue([row({ format: 'pauper', seated: 3, max: 8 })]);
    render(<RoomBrowser onJoin={vi.fn()} onWatch={vi.fn()} onHostInstead={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/Pauper/)).toBeTruthy();
    });
    expect(screen.getByText(/3\/8 seated/)).toBeTruthy();
  });
});
