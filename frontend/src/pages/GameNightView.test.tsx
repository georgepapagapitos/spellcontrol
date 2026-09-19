// @vitest-environment happy-dom
/**
 * A night that already happened is closed, like a cancelled one: no reply
 * buttons, no calendar entry, and the page says so up front — the server
 * refuses every write after its 24h grace with "This game night has already
 * happened.", and before this the visitor only found out from the 400 after
 * tapping Going (playtest batch 11).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicGameNight } from '../lib/game-nights-api';

const { fetchPublicGameNightMock } = vi.hoisted(() => ({ fetchPublicGameNightMock: vi.fn() }));
vi.mock('../lib/game-nights-api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/game-nights-api')>();
  return { ...real, fetchPublicGameNight: fetchPublicGameNightMock };
});

import { GameNightView } from './GameNightView';

const DAY = 24 * 60 * 60 * 1000;

function night(startsAt: number): PublicGameNight {
  return {
    night: {
      token: 'tok',
      title: 'Tuesday commander',
      startsAt,
      timezone: null,
      location: null,
      notes: null,
      cancelledAt: null,
      inviteOnly: false,
      format: null,
      venue: 'table',
      hostUsername: 'host',
      series: null,
    },
    rsvps: [{ displayName: 'host', status: 'going', isHost: true }],
    myRsvp: null,
    options: [],
    canRsvp: true,
  };
}

function renderNight() {
  return render(
    <MemoryRouter initialEntries={['/gn/tok']}>
      <Routes>
        <Route path="/gn/:token" element={<GameNightView />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  fetchPublicGameNightMock.mockReset();
});

describe('GameNightView — a night that already happened', () => {
  it('says so, and offers neither a reply nor a calendar entry', async () => {
    fetchPublicGameNightMock.mockResolvedValue(night(Date.now() - 3 * DAY));
    renderNight();
    expect((await screen.findByRole('status')).textContent).toContain(
      'This game night has already happened.'
    );
    expect(screen.queryByRole('button', { name: 'Going' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Add to calendar' })).toBeNull();
    // The replies people left stay on the record.
    expect(screen.getByText('host')).toBeTruthy();
  });

  it('an upcoming night still takes replies', async () => {
    fetchPublicGameNightMock.mockResolvedValue(night(Date.now() + 3 * DAY));
    renderNight();
    expect(await screen.findByRole('button', { name: 'Going' })).toBeTruthy();
    expect(screen.queryByText('This game night has already happened.')).toBeNull();
  });

  it('keeps the server’s 24h grace: a night from earlier today still takes replies', async () => {
    fetchPublicGameNightMock.mockResolvedValue(night(Date.now() - 6 * 60 * 60 * 1000));
    renderNight();
    expect(await screen.findByRole('button', { name: 'Going' })).toBeTruthy();
  });
});
