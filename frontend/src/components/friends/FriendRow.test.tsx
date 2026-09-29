// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Friend } from '@/lib/friends-client';
import { FriendRow } from './FriendRow';
import { friendPeekLine } from '@/lib/social/friend-peek';

function friend(over: Partial<Friend> = {}): Friend {
  return {
    id: 'f1',
    username: 'ada',
    displayName: 'Ada Brews',
    friendedAt: Date.now() - 3 * 86_400_000,
    cardCount: 100,
    avatarImageUrl: null,
    deckCount: 3,
    bannerImage: 'https://cards.example/atraxa.jpg',
    topColors: ['W', 'U'],
    topCommander: 'Atraxa',
    ...over,
  };
}

function renderRow(f: Friend, onRemove = vi.fn(), busy = false) {
  render(
    <MemoryRouter initialEntries={['/friends']}>
      <Routes>
        <Route
          path="/friends"
          element={
            <ul>
              <FriendRow friend={f} busy={busy} onRemove={onRemove} />
            </ul>
          }
        />
        <Route path="/u/:username" element={<p>profile page</p>} />
        <Route path="/friends/:id" element={<p>friend hub</p>} />
      </Routes>
    </MemoryRouter>
  );
  return onRemove;
}

describe('friendPeekLine', () => {
  it('names decks and the top commander, singular for one', () => {
    expect(friendPeekLine(friend())).toBe('3 decks · Brews Atraxa');
    expect(friendPeekLine(friend({ deckCount: 1, topCommander: null }))).toBe('1 deck');
  });

  it('says so plainly when there is nothing public, including an older backend', () => {
    expect(friendPeekLine(friend({ deckCount: 0 }))).toBe('No public decks yet');
    expect(friendPeekLine(friend({ deckCount: undefined }))).toBe('No public decks yet');
  });
});

describe('FriendRow', () => {
  it('is a person: identity link to the profile, peek, and friends-since', () => {
    renderRow(friend());
    const link = screen.getByRole('link', { name: /Ada Brews/ });
    expect(link.getAttribute('href')).toBe('/u/ada');
    expect(screen.getByText('@ada')).toBeTruthy();
    expect(screen.getByText('3 decks · Brews Atraxa')).toBeTruthy();
    expect(screen.getByText(/Friends since/)).toBeTruthy();
    expect(link.querySelector('img')?.getAttribute('src')).toBe('https://cards.example/atraxa.jpg');
  });

  it('draws no art for a friend with nothing published, and no jargon buttons', () => {
    renderRow(friend({ deckCount: 0, bannerImage: null, topColors: [], topCommander: null }));
    expect(document.querySelector('.friend-row-art')).toBeNull();
    expect(screen.queryByText('View shared')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('keeps the hub and Remove in the menu, and Remove hands the friend up', () => {
    const onRemove = renderRow(friend());
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Ada Brews' }));
    expect(screen.getByRole('menuitem', { name: 'View profile' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove friend' }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' }));
  });

  it('opens the friend hub from the menu', () => {
    renderRow(friend());
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Ada Brews' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trades, games and shared' }));
    expect(screen.getByText('friend hub')).toBeTruthy();
  });
});
