// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrewerCard } from '@/lib/social/brewers-client';
import type { Friend } from '@/lib/social/friends-client';

const { mockUsers, mockBrewers, mockSend, mockAccept } = vi.hoisted(() => ({
  mockUsers: vi.fn(),
  mockBrewers: vi.fn(),
  mockSend: vi.fn(),
  mockAccept: vi.fn(),
}));
vi.mock('@/lib/social/friends-client', () => ({
  searchUsers: mockUsers,
  sendFriendRequest: mockSend,
  acceptRequest: mockAccept,
}));
vi.mock('@/lib/social/brewers-client', () => ({
  searchBrewers: mockBrewers,
  followUser: vi.fn(),
  unfollowUser: vi.fn(),
}));

import { PeopleSearch } from './PeopleSearch';

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

function renderSearch(props: Partial<React.ComponentProps<typeof PeopleSearch>> = {}) {
  const onChanged = vi.fn();
  render(
    <MemoryRouter>
      <PeopleSearch
        friends={[]}
        incoming={[]}
        outgoing={[]}
        following={new Set()}
        onChanged={onChanged}
        {...props}
      />
    </MemoryRouter>
  );
  return onChanged;
}

/** Type and press Enter: the immediate path, no debounce wait. */
function search(value: string) {
  const box = screen.getByRole('textbox', { name: /find people/i });
  fireEvent.change(box, { target: { value } });
  fireEvent.submit(box.closest('form')!);
}

beforeEach(() => {
  mockUsers.mockReset().mockResolvedValue([]);
  mockBrewers.mockReset().mockResolvedValue([]);
  mockSend.mockReset().mockResolvedValue({});
  mockAccept.mockReset().mockResolvedValue({});
});

describe('PeopleSearch', () => {
  it('links to Find brewers beside the box, and shows nothing until you search', () => {
    renderSearch();
    expect(screen.getByRole('link', { name: /find brewers to follow/i }).getAttribute('href')).toBe(
      '/decks/discover/brewers'
    );
    expect(screen.queryByRole('list', { name: 'Search results' })).toBeNull();
  });

  it('merges the handle search and the brewer directory by handle', async () => {
    mockUsers.mockResolvedValue([
      { id: 'u1', username: 'ada', displayName: null, friendStatus: 'none' },
      { id: 'u2', username: 'nodecks', displayName: null, friendStatus: 'none' },
    ]);
    mockBrewers.mockResolvedValue([brewer('ada', { displayName: 'Ada Brews' })]);
    renderSearch();
    search('ad');

    const list = await screen.findByRole('list', { name: 'Search results' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    // The brewer carries a name and a Follow; the account with no decks keeps Add only.
    expect(screen.getByRole('button', { name: 'Add Ada Brews as a friend' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Follow ada' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add nodecks as a friend' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Follow nodecks' })).toBeNull();
  });

  it('still adds an account with no public decks by exact username', async () => {
    mockUsers.mockResolvedValue([
      { id: 'u2', username: 'nodecks', displayName: null, friendStatus: 'none' },
    ]);
    const onChanged = renderSearch();
    search('nodecks');
    fireEvent.click(await screen.findByRole('button', { name: 'Add nodecks as a friend' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith('nodecks'));
    expect(await screen.findByText('Request sent')).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('reads a current friend as Friends and a followed brewer as Following', async () => {
    mockBrewers.mockResolvedValue([brewer('ada')]);
    const friends = [{ id: 'f1', username: 'ada' }] as Friend[];
    renderSearch({ friends, following: new Set(['ada']) });
    search('ada');
    expect(await screen.findByText('Friends')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Follow ada' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('sends a name with a space to the brewer directory only', async () => {
    mockBrewers.mockResolvedValue([brewer('ada', { displayName: 'Ada Brews' })]);
    renderSearch();
    search('Ada Br');
    await screen.findByRole('list', { name: 'Search results' });
    expect(mockUsers).not.toHaveBeenCalled();
    expect(mockBrewers).toHaveBeenCalledWith('Ada Br');
  });

  it('survives the brewer directory failing', async () => {
    mockUsers.mockResolvedValue([
      { id: 'u2', username: 'bob', displayName: null, friendStatus: 'none' },
    ]);
    mockBrewers.mockRejectedValue(new Error('down'));
    renderSearch();
    search('bob');
    expect(await screen.findByRole('button', { name: 'Add bob as a friend' })).toBeTruthy();
  });

  it('says so when no one matches, and errors with Retry when both fail', async () => {
    renderSearch();
    search('zzz');
    expect(await screen.findByText(/No one found for/)).toBeTruthy();

    mockUsers.mockRejectedValue(new Error('down'));
    mockBrewers.mockRejectedValue(new Error('down'));
    search('yyy');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
