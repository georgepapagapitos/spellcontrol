// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameNightsTab } from './GameNights';
import { rsvpGameNight, type GameNight } from '../../lib/game-nights-api';

vi.mock('../../lib/game-nights-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/game-nights-api')>();
  return { ...actual, rsvpGameNight: vi.fn() };
});

// An online night's "Start game" hosts a session through the play store.
const hostOnline = vi.fn(async () => ({}));
const seedGameSetup = vi.fn();
vi.mock('../../store/play', () => ({
  usePlayStore: <T,>(selector: (s: object) => T): T => selector({ hostOnline, seedGameSetup }),
}));

function makeNight(overrides: Partial<GameNight> = {}): GameNight {
  return {
    id: 'night-1',
    token: 'tok-1',
    title: 'Friday commander',
    startsAt: Date.now() + 86_400_000,
    timezone: null,
    location: null,
    notes: null,
    createdAt: Date.now(),
    cancelledAt: null,
    inviteOnly: false,
    format: null,
    venue: 'table',
    hostUsername: 'alice',
    isHost: false,
    myStatus: null,
    myTradeOptIn: false,
    rsvps: [{ displayName: 'alice', status: 'going', isHost: true }],
    awaiting: [],
    options: [],
    series: null,
    blocked: [],
    guestInvites: [],
    ...overrides,
  };
}

function renderTab(props: Partial<Parameters<typeof GameNightsTab>[0]> = {}) {
  return render(
    <MemoryRouter>
      <GameNightsTab
        isGuest={false}
        nights={[]}
        loading={false}
        error={null}
        refresh={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(rsvpGameNight).mockReset();
  hostOnline.mockClear();
  seedGameSetup.mockClear();
});

describe('where a night is played', () => {
  it('a table night seeds the local setup with the going roster', () => {
    renderTab({
      nights: [
        makeNight({
          isHost: true,
          format: 'commander',
          rsvps: [
            { displayName: 'alice', status: 'going', isHost: true, username: 'alice' },
            { displayName: 'Walk-up', status: 'going', isHost: false },
          ],
        }),
      ],
    });
    expect(screen.queryByText('Online')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start a game for Friday commander' }));
    expect(seedGameSetup).toHaveBeenCalledWith(
      [
        { name: 'alice', username: 'alice' },
        { name: 'Walk-up', username: null },
      ],
      'commander'
    );
    expect(hostOnline).not.toHaveBeenCalled();
  });

  it('an online night shows the pill, and its button hosts a session in the night’s format', async () => {
    renderTab({ nights: [makeNight({ isHost: true, venue: 'online', format: 'brawl' })] });
    expect(screen.getByText('Online')).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Start a game for Friday commander' });
    expect(btn.textContent).toBe('Open the online table');
    fireEvent.click(btn);
    await waitFor(() => expect(hostOnline).toHaveBeenCalledTimes(1));
    expect(hostOnline).toHaveBeenCalledWith({
      format: 'brawl',
      startingLife: 25,
      commanderDamageEnabled: false,
      poisonEnabled: false,
    });
    expect(seedGameSetup).not.toHaveBeenCalled();
  });
});

describe('GameNightsTab', () => {
  it('guest state prompts sign-in instead of the list', () => {
    renderTab({ isGuest: true });
    expect(screen.getByText('Game nights need an account.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('No game nights planned.')).toBeNull();
  });

  it('empty state offers to plan a night', () => {
    renderTab({ nights: [] });
    expect(screen.getByText('No game nights planned.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plan a game night' })).toBeTruthy();
  });

  it('renders a night card with its RSVP tally and reply buttons', () => {
    renderTab({ nights: [makeNight()] });
    expect(screen.getByText('Friday commander')).toBeTruthy();
    expect(screen.getByText(/1 going/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Going' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Maybe' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Can't make it" })).toBeTruthy();
  });

  it('replying RSVPs against the night token and refreshes the list', async () => {
    vi.mocked(rsvpGameNight).mockResolvedValue({
      id: 'r1',
      displayName: 'me',
      status: 'maybe',
    });
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderTab({ nights: [makeNight()], refresh });

    fireEvent.click(screen.getByRole('button', { name: 'Maybe' }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(rsvpGameNight).toHaveBeenCalledWith('tok-1', { status: 'maybe' });
  });
});
