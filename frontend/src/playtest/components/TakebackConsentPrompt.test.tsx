// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { applyAction, createGameState, makePlayer } from '@/lib/game-state';
import type { GameRequest } from '@/lib/games-api';
import { TakebackConsentPrompt } from './TakebackConsentPrompt';
import type { OnlineTable } from '../hooks/use-online-table';

function onlineGame() {
  const g = createGameState({
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
        id: 'me-id',
        userId: 'me-id',
        seat: 0,
        name: 'Me',
        startingLife: 40,
        isHost: true,
      }),
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Rival', startingLife: 40 }),
    ],
  });
  return applyAction(g, { type: 'start' });
}

function request(overrides: Partial<GameRequest> = {}): GameRequest {
  return {
    id: 'req1',
    code: 'ABCD',
    kind: 'rewind',
    payload: { steps: 2, summary: 'Created token: Squirrel' },
    requesterSeat: 1,
    approvals: {},
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

const mySeat: OnlineTable = { activeSeat: null, opponents: [], mySeat: 0 };

beforeEach(() => {
  usePlayStore.setState({
    online: onlineGame(),
    onlineRequests: {},
    respondGameRequest: vi.fn().mockResolvedValue(request({ status: 'approved' })),
  });
});

describe('TakebackConsentPrompt', () => {
  it('renders nothing with no incoming pending request', () => {
    const { container } = render(<TakebackConsentPrompt onlineTable={mySeat} />);
    expect(container.innerHTML).toBe('');
  });

  it('does not show this seat’s own outgoing request — only requests from other seats', () => {
    usePlayStore.setState({ onlineRequests: { 0: request({ requesterSeat: 0 }) } });
    const { container } = render(<TakebackConsentPrompt onlineTable={mySeat} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows who is asking, how many steps, and the summary', () => {
    usePlayStore.setState({ onlineRequests: { 1: request() } });
    render(<TakebackConsentPrompt onlineTable={mySeat} />);
    const region = screen.getByRole('region', { name: 'Takeback request' });
    expect(within(region).getByText('Rival')).toBeTruthy();
    expect(region.textContent).toContain('2 actions');
    expect(region.textContent).toContain('Created token: Squirrel');
  });

  it('is non-blocking: no aria-modal, no backdrop, buttons are plain focusable elements', () => {
    usePlayStore.setState({ onlineRequests: { 1: request() } });
    render(<TakebackConsentPrompt onlineTable={mySeat} />);
    expect(document.querySelector('[aria-modal]')).toBeNull();
    const approve = screen.getByRole('button', { name: 'Approve' });
    const decline = screen.getByRole('button', { name: 'Decline' });
    expect(approve.tagName).toBe('BUTTON');
    expect(decline.tagName).toBe('BUTTON');
    approve.focus();
    expect(document.activeElement).toBe(approve);
  });

  it('approving calls respondGameRequest with the request id and true', async () => {
    usePlayStore.setState({ onlineRequests: { 1: request() } });
    render(<TakebackConsentPrompt onlineTable={mySeat} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await Promise.resolve();
    expect(usePlayStore.getState().respondGameRequest).toHaveBeenCalledWith('req1', true);
  });

  it('declining calls respondGameRequest with false', async () => {
    usePlayStore.setState({ onlineRequests: { 1: request() } });
    render(<TakebackConsentPrompt onlineTable={mySeat} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await Promise.resolve();
    expect(usePlayStore.getState().respondGameRequest).toHaveBeenCalledWith('req1', false);
  });

  it('surfaces a response error without crashing, and re-enables the buttons', async () => {
    usePlayStore.setState({
      onlineRequests: { 1: request() },
      respondGameRequest: vi.fn().mockRejectedValue(new Error('Request already resolved.')),
    });
    render(<TakebackConsentPrompt onlineTable={mySeat} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Request already resolved.');
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
  });
});
