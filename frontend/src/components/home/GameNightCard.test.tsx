// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GameNight } from '../../lib/game-nights-api';

vi.mock('../play/GameNights', () => ({
  useGameNights: vi.fn(),
}));
vi.mock('../../store/auth', () => ({
  useAuth: vi.fn(),
}));

import { GameNightCard } from './GameNightCard';
import { useGameNights } from '../play/GameNights';
import { useAuth } from '../../store/auth';

const mockUseGameNights = useGameNights as unknown as ReturnType<typeof vi.fn>;
const mockUseAuth = useAuth as unknown as ReturnType<typeof vi.fn>;

function gameNight(overrides: Partial<GameNight> & { startsAt: number }): GameNight {
  return {
    id: `gn-${Math.random()}`,
    token: 'tok',
    title: 'Game night',
    timezone: null,
    location: null,
    notes: null,
    createdAt: Date.now(),
    cancelledAt: null,
    inviteOnly: false,
    format: null,
    hostUsername: 'host',
    isHost: false,
    myStatus: null,
    myTradeOptIn: false,
    rsvps: [],
    awaiting: [],
    options: [],
    series: null,
    blocked: [],
    ...overrides,
  };
}

function setAuth(status: 'authed' | 'guest') {
  mockUseAuth.mockImplementation((sel: (s: { status: string }) => unknown) => sel({ status }));
}

function renderCard() {
  return render(
    <MemoryRouter>
      <GameNightCard />
    </MemoryRouter>
  );
}

describe('GameNightCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a sign-in message for guests without calling useGameNights with fetch enabled', () => {
    setAuth('guest');
    mockUseGameNights.mockReturnValue({
      nights: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    renderCard();
    expect(screen.getByText('Sign in to see your game nights.')).toBeTruthy();
    expect(mockUseGameNights).toHaveBeenCalledWith(false);
  });

  it('shows the loading skeleton', () => {
    setAuth('authed');
    mockUseGameNights.mockReturnValue({ nights: [], loading: true, error: null, refresh: vi.fn() });
    renderCard();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
  });

  it('surfaces the hook error with a working retry', () => {
    setAuth('authed');
    const refresh = vi.fn();
    mockUseGameNights.mockReturnValue({
      nights: [],
      loading: false,
      error: "Couldn't load game nights.",
      refresh,
    });
    renderCard();
    expect(screen.getByText("Couldn't load game nights.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state with a "Plan one" CTA when there are no upcoming nights', () => {
    setAuth('authed');
    mockUseGameNights.mockReturnValue({
      nights: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    renderCard();
    expect(screen.getByText('No game nights on the calendar.')).toBeTruthy();
    const cta = screen.getByRole('link', { name: 'Plan one' });
    expect(cta.getAttribute('href')).toBe('/play?tab=nights');
  });

  it('lists upcoming nights soonest-first with an RSVP chip and full aria-label', () => {
    setAuth('authed');
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const later = gameNight({ title: 'Later Night', startsAt: now + 100_000, myStatus: 'maybe' });
    const sooner = gameNight({ title: 'Sooner Night', startsAt: now + 1_000, isHost: true });
    mockUseGameNights.mockReturnValue({
      nights: [later, sooner],
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    renderCard();
    expect(screen.getByText('Sooner Night')).toBeTruthy();
    expect(screen.getByText('Hosting')).toBeTruthy();
    expect(screen.getByText('Later Night')).toBeTruthy();
    expect(screen.getByText('Maybe')).toBeTruthy();
    const links = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href') === '/play?tab=nights');
    // Every row links to the same full RSVP UI — never a per-night deep link
    // or a second mutation path on Home.
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('applies the 3-night limit and skips cancelled/past nights (via upcomingGameNights)', () => {
    setAuth('authed');
    const now = 1_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const nights = [
      gameNight({ title: 'Past', startsAt: now - 1000 }),
      gameNight({ title: 'Cancelled', startsAt: now + 1000, cancelledAt: now }),
      ...[1, 2, 3, 4].map((i) => gameNight({ title: `Night ${i}`, startsAt: now + i * 1000 })),
    ];
    mockUseGameNights.mockReturnValue({ nights, loading: false, error: null, refresh: vi.fn() });
    renderCard();
    expect(screen.queryByText('Past')).toBeNull();
    expect(screen.queryByText('Cancelled')).toBeNull();
    expect(screen.getByText('Night 1')).toBeTruthy();
    expect(screen.getByText('Night 2')).toBeTruthy();
    expect(screen.getByText('Night 3')).toBeTruthy();
    expect(screen.queryByText('Night 4')).toBeNull();
  });
});
