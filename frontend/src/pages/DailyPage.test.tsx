// @vitest-environment happy-dom
/**
 * DailyPage (E558): the guest loop (guess, clue unlock, solve, share), the
 * give-up confirm, the signed-in sync (post what the server hasn't seen, adopt
 * its history, show friends), the load error's Retry, and axe on the live puzzle.
 */
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import { useAuth } from '@/store/auth';
import { useDailyStore } from '@/store/daily';
import { buildCardIndex } from '@/lib/daily/cards-index';
import type { DailySchedule } from '@/lib/daily/schedule';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
}
expect.extend(matchers);
const runAxe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const TODAY = '2026-10-03';

const schedule: DailySchedule = {
  version: 1,
  generatedAt: '2026-10-01T00:00:00.000Z',
  epoch: '2026-10-01',
  puzzles: [
    {
      date: TODAY,
      number: 3,
      name: 'Swords to Plowshares',
      colors: 'W',
      mv: 1,
      typeLine: 'Instant',
      rarity: 'uncommon',
      year: 1993,
      setName: 'Limited Edition Alpha',
      rulesText: 'Exile target creature. Its controller gains life equal to its power.',
      flavor: '',
      art: 'https://cards.scryfall.io/art_crop/front/swords.jpg',
    },
  ],
};

const index = buildCardIndex({
  version: 1,
  generatedAt: '2026-10-01T00:00:00.000Z',
  rarities: ['common', 'uncommon', 'rare', 'mythic', 'special'],
  cards: [
    ['Lightning Bolt', 'R', 1, 'Instant', 0, 1993],
    ['Path to Exile', 'W', 1, 'Instant', 1, 2009],
    ['Swords to Plowshares', 'W', 1, 'Instant', 1, 1993],
  ],
});

const { loadScheduleMock, loadCardIndexMock, postMock, meMock, friendsMock } = vi.hoisted(() => ({
  loadScheduleMock: vi.fn(),
  loadCardIndexMock: vi.fn(),
  postMock: vi.fn(),
  meMock: vi.fn(),
  friendsMock: vi.fn(),
}));

vi.mock('@/lib/daily/schedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/daily/schedule')>()),
  loadSchedule: loadScheduleMock,
}));
vi.mock('@/lib/daily/cards-index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/daily/cards-index')>()),
  loadCardIndex: loadCardIndexMock,
}));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('@/lib/daily/daily-client', () => ({
  postDailyResults: postMock,
  fetchMyDailyResults: meMock,
  fetchDailyFriends: friendsMock,
}));

import { DailyPage } from './DailyPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/daily']}>
      <DailyPage />
    </MemoryRouter>
  );
}

function guess(name: string) {
  const box = screen.getByRole('combobox', { name: 'Card name' });
  fireEvent.change(box, { target: { value: name } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

function signIn() {
  useAuth.setState({
    user: { id: 'u1', username: 'me', role: 'user' },
    status: 'authed',
    error: null,
    autoLinkedAt: null,
    profile: null,
  } as never);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  loadScheduleMock.mockReset().mockResolvedValue(schedule);
  loadCardIndexMock.mockReset().mockResolvedValue(index);
  postMock.mockReset().mockResolvedValue(1);
  meMock.mockReset().mockResolvedValue([]);
  friendsMock.mockReset().mockResolvedValue([]);
  useDailyStore.setState({ guesses: {}, results: [], unposted: [] });
  useAuth.setState({ user: null, status: 'guest', error: null, profile: null } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DailyPage, as a guest', () => {
  it('scores a miss, unlocks the next clue, then solves and offers the result to copy', async () => {
    renderPage();
    await screen.findByRole('combobox', { name: 'Card name' });
    // The weekday and date are locale-formatted, so match the stable ends.
    expect(screen.getByText(/^#3 · .+ · Guess 1 of 6$/)).toBeTruthy();
    const clues = screen.getByRole('list', { name: 'Clues' });
    expect(within(clues).getAllByText('Opens after a miss')).toHaveLength(5);

    guess('lightning bolt');
    const rows = screen.getByRole('list', { name: 'Your guesses, newest first' });
    expect(within(rows).getByText('Lightning Bolt')).toBeTruthy();
    expect(within(rows).getByText(/Colours:/).parentElement?.textContent).toContain('no match');
    expect(within(clues).getAllByText('Opens after a miss')).toHaveLength(4);
    expect(within(clues).getByText('White')).toBeTruthy();

    guess('Swords to Plowshares');
    expect(await screen.findByRole('heading', { name: 'Solved in 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy result' })).toBeTruthy();
    expect(useDailyStore.getState().results).toEqual([{ date: TODAY, solved: true, guesses: 2 }]);
    expect(useDailyStore.getState().unposted).toEqual([TODAY]);
    expect(postMock).not.toHaveBeenCalled();
    const signInLink = screen.getByRole('link', { name: 'Sign in' });
    expect(signInLink.getAttribute('href')).toBe('/auth?returnTo=%2Fdaily');
  });

  it('refuses an unknown name and a repeat, saying why', async () => {
    renderPage();
    await screen.findByRole('combobox', { name: 'Card name' });
    guess('Not A Card');
    expect(screen.getByRole('alert').textContent).toBe(
      'No card by that name. Pick one from the list.'
    );
    guess('Lightning Bolt');
    guess('Lightning Bolt');
    expect(screen.getByRole('alert').textContent).toBe("You've already guessed Lightning Bolt.");
  });

  it('suggests names and picks one with the keyboard', async () => {
    renderPage();
    const box = await screen.findByRole('combobox', { name: 'Card name' });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'pa' } });
    expect(screen.getByRole('option', { name: 'Path to Exile' })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toMatch(/-option-0$/);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(useDailyStore.getState().guesses[TODAY]).toEqual(['Path to Exile']);
  });

  it('asks before giving up, then ends the day', async () => {
    renderPage();
    await screen.findByRole('combobox', { name: 'Card name' });
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(screen.getByRole('combobox', { name: 'Card name' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    const group = screen.getByRole('group', { name: "Give up today's card" });
    fireEvent.click(within(group).getByRole('button', { name: 'Give up' }));
    expect(await screen.findByRole('heading', { name: 'Out of guesses' })).toBeTruthy();
    expect(useDailyStore.getState().results[0]).toEqual({ date: TODAY, solved: false, guesses: 6 });
  });

  it('shows the error and retries the load', async () => {
    loadScheduleMock
      .mockReset()
      .mockRejectedValueOnce(new Error("Couldn't load today's card."))
      .mockResolvedValue(schedule);
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load today's card.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('combobox', { name: 'Card name' })).toBeTruthy();
  });

  it('has no axe violations mid-puzzle', async () => {
    const { container } = renderPage();
    await screen.findByRole('combobox', { name: 'Card name' });
    guess('Lightning Bolt');
    expect(await runAxe(container)).toHaveNoViolations();
  });
});

describe('DailyPage, signed in', () => {
  it("posts what the server hasn't seen, adopts its history, and lists friends", async () => {
    useDailyStore.setState({
      guesses: {},
      results: [{ date: '2026-10-02', solved: true, guesses: 4 }],
      unposted: ['2026-10-02'],
    });
    meMock.mockResolvedValue([
      { date: '2026-10-02', solved: true, guesses: 4 },
      { date: '2026-10-01', solved: true, guesses: 2 },
    ]);
    friendsMock.mockResolvedValue([
      {
        userId: 'f1',
        username: 'mika',
        displayName: 'Mika',
        avatarImageUrl: null,
        result: { solved: true, guesses: 2 },
        streak: 30,
      },
      {
        userId: 'f2',
        username: 'sam',
        displayName: null,
        avatarImageUrl: null,
        result: null,
        streak: 0,
      },
    ]);
    signIn();
    renderPage();
    await waitFor(() => expect(screen.getByText('Mika')).toBeTruthy());
    expect(screen.getByText('Not played')).toBeTruthy();
    expect(postMock).toHaveBeenCalledWith([{ date: '2026-10-02', solved: true, guesses: 4 }]);
    await waitFor(() => expect(useDailyStore.getState().results).toHaveLength(2));
    expect(useDailyStore.getState().unposted).toEqual([]);
    expect(friendsMock).toHaveBeenCalledWith(TODAY);

    guess('Swords to Plowshares');
    await waitFor(() =>
      expect(postMock).toHaveBeenLastCalledWith([{ date: TODAY, solved: true, guesses: 1 }])
    );
    expect(screen.getByRole('heading', { name: 'Solved in 1' })).toBeTruthy();
  });

  it('keeps the friends panel usable when its load fails', async () => {
    friendsMock
      .mockRejectedValueOnce(new Error("Couldn't load your friends' results."))
      .mockResolvedValue([]);
    signIn();
    renderPage();
    await screen.findByText("Couldn't load your friends' results.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Add friends to compare scores.')).toBeTruthy();
  });
});
