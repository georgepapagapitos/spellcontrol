// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAuth } from '../../store/auth';
import { TonightTrades } from './TonightTrades';
import {
  fetchTonightTrades,
  rsvpGameNight,
  type GameNight,
  type TonightTradeAttendee,
} from '../../lib/game-nights-api';

vi.mock('../../lib/game-nights-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/game-nights-api')>();
  return { ...actual, fetchTonightTrades: vi.fn(), rsvpGameNight: vi.fn() };
});

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
    hostUsername: 'me',
    isHost: true,
    myStatus: 'going',
    myTradeOptIn: false,
    rsvps: [],
    awaiting: [],
    options: [],
    series: null,
    blocked: [],
    ...overrides,
  };
}

function attendee(
  overrides: Partial<TonightTradeAttendee> & { userId: string }
): TonightTradeAttendee {
  return {
    username: overrides.userId,
    displayName: overrides.userId,
    lists: [],
    tradeableCards: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(fetchTonightTrades).mockReset();
  vi.mocked(rsvpGameNight).mockReset();
  useAuth.setState({ user: { id: 'me', username: 'me', role: 'user' } });
});

describe('TonightTrades', () => {
  it('toggle-off state shows no fetch', () => {
    render(
      <TonightTrades
        night={makeNight({ myTradeOptIn: false })}
        refresh={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const checkbox = screen.getByLabelText("Join tonight's trades") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(screen.queryByText('You can get tonight')).toBeNull();
    expect(screen.queryByText('Bring tonight')).toBeNull();
    expect(fetchTonightTrades).not.toHaveBeenCalled();
  });

  it('toggle-on triggers the fetch and renders both populated sections', async () => {
    vi.mocked(rsvpGameNight).mockResolvedValue({
      id: 'r1',
      displayName: 'me',
      status: 'going',
      tradeOptIn: true,
    });
    vi.mocked(fetchTonightTrades).mockResolvedValue([
      attendee({
        userId: 'me',
        lists: [
          {
            id: 'l1',
            name: 'Wants',
            entries: [
              {
                id: 'e1',
                name: 'Sol Ring',
                scryfallId: 'sf1',
                setCode: 'tst',
                collectorNumber: '1',
                finish: 'nonfoil',
                oracleId: 'o-sol',
                quantity: 1,
              },
            ],
            order: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        tradeableCards: [
          {
            name: 'Lightning Bolt',
            oracleId: 'o-bolt',
            colors: ['R'],
            cmc: 1,
            typeLine: 'Instant',
          },
        ],
      }),
      attendee({
        userId: 'a',
        username: 'alice',
        displayName: 'Alice',
        tradeableCards: [
          { name: 'Sol Ring', oracleId: 'o-sol', colors: [], cmc: 1, typeLine: 'Artifact' },
        ],
        lists: [
          {
            id: 'l2',
            name: 'Alice wants',
            entries: [
              {
                id: 'e2',
                name: 'Lightning Bolt',
                scryfallId: 'sf2',
                setCode: 'tst',
                collectorNumber: '1',
                finish: 'nonfoil',
                oracleId: 'o-bolt',
                quantity: 1,
              },
            ],
            order: 0,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      }),
    ]);

    render(
      <TonightTrades
        night={makeNight({ myTradeOptIn: false })}
        refresh={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText("Join tonight's trades"));

    expect(await screen.findByText('You can get tonight')).toBeTruthy();
    expect(screen.getByText('Bring tonight')).toBeTruthy();
    expect(await screen.findByText('Sol Ring')).toBeTruthy();
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(fetchTonightTrades).toHaveBeenCalledWith('night-1');
  });

  it('empty-both renders the two per-section empty states, not a blank sheet', async () => {
    vi.mocked(fetchTonightTrades).mockResolvedValue([
      attendee({ userId: 'me' }),
      attendee({ userId: 'a', username: 'alice' }),
    ]);
    render(
      <TonightTrades
        night={makeNight({ myTradeOptIn: true })}
        refresh={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(await screen.findByText('Nothing to get tonight.')).toBeTruthy();
    expect(screen.getByText('Nothing to bring tonight.')).toBeTruthy();
  });
});
