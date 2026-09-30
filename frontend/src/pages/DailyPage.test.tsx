// @vitest-environment happy-dom
/**
 * DailyPage (E558) on the server API: the guest loop (each move sends the stored
 * guesses), the server's error sentence shown inline, the give-up confirm, a
 * signed-in player's moves (no guesses sent) and history merge, the art served
 * blurred from /api/daily/art and never from the card's own URL mid-game, the
 * load error's Retry, and axe on the live puzzle.
 */
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';
import { useAuth } from '@/store/auth';
import { useDailyStore } from '@/store/daily';
import { buildNames } from '@/lib/daily/names';
import type { DailyState, ScoredGuess } from '@/lib/daily/daily-client';

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AxeMatchers {}
}
expect.extend(matchers);
const runAxe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const TODAY = '2026-10-03';
const ANSWER_ART = 'https://cards.scryfall.io/art_crop/front/swords.jpg';

const bolt: ScoredGuess = {
  name: 'Lightning Bolt',
  cells: {
    colors: { value: 'R', mark: 'miss' },
    mv: { value: 1, mark: 'hit' },
    type: { value: 'Instant', mark: 'hit' },
    rarity: { value: 'common', mark: 'near' },
    year: { value: 1993, mark: 'hit' },
  },
};
const swords: ScoredGuess = {
  name: 'Swords to Plowshares',
  cells: {
    colors: { value: 'W', mark: 'hit' },
    mv: { value: 1, mark: 'hit' },
    type: { value: 'Instant', mark: 'hit' },
    rarity: { value: 'uncommon', mark: 'hit' },
    year: { value: 1993, mark: 'hit' },
  },
};

const CLUES = [
  { label: 'Mana value', value: '1' },
  { label: 'Colors', value: 'White' },
  { label: 'Type', value: 'Instant' },
  { label: 'First printed', value: 'Limited Edition Alpha · 1993' },
  { label: 'Rules text', value: 'Exile target creature.', prose: true as const },
  { label: 'First letter', value: 'S' },
];

function state(over: Partial<DailyState>): DailyState {
  return {
    date: TODAY,
    number: 4,
    maxGuesses: 6,
    status: 'playing',
    guesses: [],
    clues: CLUES.slice(0, 1),
    artLevel: 0,
    answer: null,
    ...over,
  };
}

const solved = state({
  status: 'solved',
  guesses: [bolt, swords],
  clues: CLUES,
  artLevel: null,
  answer: {
    name: 'Swords to Plowshares',
    typeLine: 'Instant',
    setName: 'Limited Edition Alpha',
    year: 1993,
    colors: 'W',
    art: ANSWER_ART,
  },
});

const { playMock, postMock, meMock, friendsMock, namesMock } = vi.hoisted(() => ({
  playMock: vi.fn(),
  postMock: vi.fn(),
  meMock: vi.fn(),
  friendsMock: vi.fn(),
  namesMock: vi.fn(),
}));

vi.mock('@/lib/daily/daily-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/daily/daily-client')>()),
  playDaily: playMock,
  postDailyResults: postMock,
  fetchMyDailyResults: meMock,
  fetchDailyFriends: friendsMock,
}));
vi.mock('@/lib/daily/names', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/daily/names')>()),
  loadDailyNames: namesMock,
}));
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

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
  playMock.mockReset().mockResolvedValue(state({}));
  postMock.mockReset().mockResolvedValue(1);
  meMock.mockReset().mockResolvedValue([]);
  friendsMock.mockReset().mockResolvedValue([]);
  namesMock
    .mockReset()
    .mockResolvedValue(buildNames(['Lightning Bolt', 'Path to Exile', 'Swords to Plowshares']));
  useDailyStore.setState({ guesses: {}, results: [], unposted: [] });
  useAuth.setState({ user: null, status: 'guest', error: null, profile: null } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DailyPage, as a guest', () => {
  it('sends the stored guesses with each move, shows the scored row, then solves', async () => {
    useDailyStore.setState({ guesses: {}, results: [], unposted: [] });
    renderPage();
    await screen.findByRole('combobox', { name: 'Card name' });
    expect(playMock).toHaveBeenLastCalledWith({ guesses: [] });
    // Mid-game the art comes from our API, blurred; never the card's own URL.
    const art = screen.getByAltText("Today's card art, blurred") as HTMLImageElement;
    expect(art.src).toMatch(/\/api\/daily\/art\?date=2026-10-03&level=0$/);
    expect(document.body.innerHTML).not.toContain(ANSWER_ART);
    expect(
      within(screen.getByRole('list', { name: 'Clues' })).getAllByText('Opens after a miss')
    ).toHaveLength(5);

    playMock.mockResolvedValueOnce(
      state({ guesses: [bolt], clues: CLUES.slice(0, 2), artLevel: 1 })
    );
    guess('lightning bolt');
    const rows = await screen.findByRole('list', { name: 'Your guesses, newest first' });
    expect(playMock).toHaveBeenLastCalledWith({ guesses: [], guess: 'lightning bolt' });
    expect(within(rows).getByText(/Colors:/).parentElement?.textContent).toContain('no match');
    expect(useDailyStore.getState().guesses[TODAY]).toEqual(['Lightning Bolt']);
    expect(screen.getByText('White')).toBeTruthy();
    expect((screen.getByAltText("Today's card art, blurred") as HTMLImageElement).src).toMatch(
      /level=1$/
    );

    playMock.mockResolvedValueOnce(solved);
    guess('Swords to Plowshares');
    expect(await screen.findByRole('heading', { name: 'Solved in 2' })).toBeTruthy();
    expect(playMock).toHaveBeenLastCalledWith({
      guesses: ['Lightning Bolt'],
      guess: 'Swords to Plowshares',
    });
    expect(screen.getByRole('button', { name: 'Copy result' })).toBeTruthy();
    expect(useDailyStore.getState().results).toEqual([{ date: TODAY, solved: true, guesses: 2 }]);
    expect(useDailyStore.getState().unposted).toEqual([TODAY]);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/auth?returnTo=%2Fdaily'
    );
  });

  it("shows the server's sentence when a guess doesn't count", async () => {
    renderPage();
    await screen.findByRole('combobox', { name: 'Card name' });
    playMock.mockRejectedValueOnce(new Error('No card by that name. Pick one from the list.'));
    guess('Not A Card');
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No card by that name. Pick one from the list.'
    );
    expect(useDailyStore.getState().guesses[TODAY]).toBeUndefined();
  });

  it('suggests names and picks one with the keyboard', async () => {
    renderPage();
    const box = await screen.findByRole('combobox', { name: 'Card name' });
    await waitFor(() => expect(box.getAttribute('placeholder')).toBe('Type a card name'));
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'pa' } });
    expect(screen.getByRole('option', { name: 'Path to Exile' })).toBeTruthy();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box.getAttribute('aria-activedescendant')).toMatch(/-option-0$/);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() =>
      expect(playMock).toHaveBeenLastCalledWith({ guesses: [], guess: 'Path to Exile' })
    );
  });

  it('asks before giving up, then shows the answer', async () => {
    renderPage();
    await screen.findByRole('combobox', { name: 'Card name' });
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(playMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Give up' }));
    playMock.mockResolvedValueOnce({ ...solved, status: 'failed', guesses: [] });
    const group = screen.getByRole('group', { name: "Give up today's card" });
    fireEvent.click(within(group).getByRole('button', { name: 'Give up' }));
    expect(await screen.findByRole('heading', { name: 'Out of guesses' })).toBeTruthy();
    expect(playMock).toHaveBeenLastCalledWith({ guesses: [], giveUp: true });
    expect(useDailyStore.getState().results[0]).toEqual({ date: TODAY, solved: false, guesses: 6 });
  });

  it('shows the load error and retries', async () => {
    playMock
      .mockReset()
      .mockRejectedValueOnce(new Error("Couldn't load today's card."))
      .mockResolvedValue(state({}));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load today's card.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('combobox', { name: 'Card name' })).toBeTruthy();
  });

  it('has no axe violations mid-puzzle', async () => {
    playMock.mockResolvedValue(state({ guesses: [bolt], clues: CLUES.slice(0, 2), artLevel: 1 }));
    const { container } = renderPage();
    await screen.findByRole('list', { name: 'Your guesses, newest first' });
    expect(await runAxe(container)).toHaveNoViolations();
  });
});

describe('DailyPage, signed in', () => {
  it("sends only the move, merges a guest's past days, and lists friends", async () => {
    useDailyStore.setState({
      guesses: { [TODAY]: ['Lightning Bolt'] },
      results: [
        { date: '2026-10-02', solved: true, guesses: 4 },
        { date: TODAY, solved: true, guesses: 1 },
      ],
      unposted: ['2026-10-02', TODAY],
    });
    meMock.mockResolvedValue([{ date: '2026-10-01', solved: true, guesses: 2 }]);
    friendsMock.mockResolvedValue([
      {
        userId: 'f1',
        username: 'mika',
        displayName: 'Mika',
        avatarImageUrl: null,
        result: { solved: true, guesses: 2 },
        streak: 30,
      },
    ]);
    signIn();
    renderPage();
    await screen.findByText('Mika');
    // The server holds a signed-in player's guesses, so none are sent.
    expect(playMock).toHaveBeenCalledWith({});
    // Only past days are merged; today's is recorded as you play.
    expect(postMock).toHaveBeenCalledWith([{ date: '2026-10-02', solved: true, guesses: 4 }]);
    expect(friendsMock).toHaveBeenCalledWith(TODAY);

    playMock.mockResolvedValueOnce(solved);
    guess('Swords to Plowshares');
    await screen.findByRole('heading', { name: 'Solved in 2' });
    expect(playMock).toHaveBeenLastCalledWith({ guess: 'Swords to Plowshares' });
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
