// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrewerCard, BrewerRails } from '../lib/brewers-client';

const { mockRails, mockSearch } = vi.hoisted(() => ({ mockRails: vi.fn(), mockSearch: vi.fn() }));
vi.mock('../lib/brewers-client', () => ({
  fetchBrewerRails: mockRails,
  searchBrewers: mockSearch,
}));

let authStatus: 'guest' | 'authed' = 'guest';
vi.mock('../store/auth', () => ({
  useAuth: <T,>(selector: (s: { status: string }) => T): T => selector({ status: authStatus }),
}));

import { DiscoverBrewersPage } from './DiscoverBrewersPage';

function brewer(username: string, over: Partial<BrewerCard> = {}): BrewerCard {
  return {
    username,
    displayName: null,
    avatarImageUrl: null,
    bannerImage: null,
    deckCount: 2,
    followerCount: 0,
    topColors: ['G'],
    topCommander: null,
    joinedAt: 1,
    ...over,
  };
}

function rails(over: Partial<BrewerRails> = {}): BrewerRails {
  return {
    newest: [],
    mostLiked: [],
    mostFollowed: [],
    sharedCommanders: [],
    spotlight: null,
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/decks/discover/brewers']}>
      <DiscoverBrewersPage />
    </MemoryRouter>
  );
}

function type(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search brewers' }), {
    target: { value },
  });
}

beforeEach(() => {
  authStatus = 'guest';
  mockRails.mockReset();
  mockSearch.mockReset();
});

describe('DiscoverBrewersPage rails', () => {
  it('describes brewers, not the Decks tab subtitle about public decks', async () => {
    mockRails.mockResolvedValue(rails());
    renderPage();
    expect(await screen.findByText('Find brewers to follow and see what they build.')).toBeTruthy();
    expect(screen.queryByText(/public decks from the spellcontrol community/i)).toBeNull();
  });

  it('renders each non-empty rail with its heading and the spotlight', async () => {
    authStatus = 'authed';
    mockRails.mockResolvedValue(
      rails({
        sharedCommanders: [brewer('sam')],
        newest: [brewer('nia'), brewer('ola')],
        mostFollowed: [brewer('pat')],
        spotlight: brewer('star', { displayName: 'Star Brewer' }),
      })
    );
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Brewer spotlight' })).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Brewer spotlight',
      'Brewing your commanders',
      'Newest brewers',
      'Most followed brewers',
    ]);
    expect(screen.getByRole('link', { name: /^Star Brewer/ }).getAttribute('href')).toBe('/u/star');
    expect(screen.getAllByRole('link', { name: /^nia/ })).toHaveLength(1);
  });

  it('renders nothing for a rail that arrives empty', async () => {
    mockRails.mockResolvedValue(rails({ newest: [brewer('nia')] }));
    renderPage();
    await screen.findByRole('heading', { name: 'Newest brewers' });
    expect(screen.queryByRole('heading', { name: 'Most liked brewers' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Most followed brewers' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Brewer spotlight' })).toBeNull();
    expect(screen.queryByText(/no brewers/i)).toBeNull();
  });

  it('shows one honest empty state when everything is empty', async () => {
    mockRails.mockResolvedValue(rails());
    renderPage();
    expect(await screen.findByText('No brewers to show yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to your decks' }).getAttribute('href')).toBe(
      '/decks'
    );
  });

  it('shows a loading status first, then an error with Retry that reloads', async () => {
    mockRails
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(rails({ newest: [brewer('nia')] }));
    renderPage();
    expect(screen.getByRole('status').textContent).toContain('Loading brewers');
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Newest brewers' })).toBeTruthy();
    expect(mockRails).toHaveBeenCalledTimes(2);
  });

  it('marks Brewers as the current view of the Discover switch', async () => {
    mockRails.mockResolvedValue(rails());
    renderPage();
    expect(screen.getByRole('tab', { name: 'Brewers' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Decks' }).getAttribute('aria-selected')).toBe('false');
    await screen.findByText('No brewers to show yet.');
  });
});

describe('DiscoverBrewersPage search', () => {
  beforeEach(() => {
    mockRails.mockResolvedValue(rails({ newest: [brewer('nia')] }));
  });

  it('does nothing under two characters and keeps the rails', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Newest brewers' });
    type('a');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(mockSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Newest brewers' })).toBeTruthy();
  });

  it('replaces the rails with results, and restores them when cleared', async () => {
    mockSearch.mockResolvedValue([brewer('ada', { displayName: 'Ada Brews' })]);
    renderPage();
    await screen.findByRole('heading', { name: 'Newest brewers' });
    type('ad');
    expect((await screen.findByRole('link', { name: /^Ada Brews/ })).getAttribute('href')).toBe(
      '/u/ada'
    );
    expect(mockSearch).toHaveBeenCalledWith('ad');
    expect(screen.queryByRole('heading', { name: 'Newest brewers' })).toBeNull();
    type('');
    expect(await screen.findByRole('heading', { name: 'Newest brewers' })).toBeTruthy();
  });

  it('says so when nothing matches', async () => {
    mockSearch.mockResolvedValue([]);
    renderPage();
    type('zzz');
    expect(await screen.findByText('No brewers match “zzz”.')).toBeTruthy();
  });

  it('shows an error with Retry that searches again', async () => {
    mockSearch.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([brewer('ada')]);
    renderPage();
    type('ada');
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('link', { name: /^ada/ })).toBeTruthy());
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });
});
