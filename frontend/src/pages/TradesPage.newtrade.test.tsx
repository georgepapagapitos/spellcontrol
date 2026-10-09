// @vitest-environment happy-dom
/** TradesPage "New trade": the friend picker, its navigation and its empty state. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Friend } from '@/lib/social/friends-client';

vi.mock('../store/auth', () => ({
  useAuth: (sel: (s: { status: string }) => unknown) => sel({ status: 'authed' }),
}));
vi.mock('../store/collection', () => ({
  useCollectionStore: (sel: (s: { cards: unknown[]; binders: unknown[] }) => unknown) =>
    sel({ cards: [], binders: [] }),
}));
vi.mock('@/lib/cards/card-thumbs', () => ({
  useCardThumb: () => undefined,
  usePrintingThumb: () => ({ src: undefined, id: undefined }),
}));

const listTrades = vi.fn();
vi.mock('@/lib/trade/trades-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/trade/trades-client')>(
    '@/lib/trade/trades-client'
  );
  return { ...actual, listTrades: (...a: unknown[]) => listTrades(...a) };
});

const listFriends = vi.fn();
vi.mock('@/lib/social/friends-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social/friends-client')>(
    '@/lib/social/friends-client'
  );
  return { ...actual, listFriends: () => listFriends() };
});

import { TradesPage } from './TradesPage';

function friend(id: string, username: string, displayName: string | null = null): Friend {
  return { id, username, displayName, friendedAt: 1, cardCount: 10 };
}

function Where() {
  const loc = useLocation();
  return <p>{`at ${loc.pathname}${loc.search}`}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/trades']}>
      <Routes>
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/friends" element={<Where />} />
        <Route path="/friends/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

async function openPicker() {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /New trade/ }));
  return screen.findByRole('dialog');
}

describe('TradesPage New trade', () => {
  beforeEach(() => {
    listTrades.mockReset().mockResolvedValue({ offers: [], truncated: false });
    listFriends.mockReset();
  });

  it('opens a picker listing friends, and a row opens that friend’s Collection tab', async () => {
    listFriends.mockResolvedValue([friend('f1', 'ada', 'Ada Brews'), friend('f2', 'bo')]);
    const dialog = await openPicker();
    expect(await screen.findByRole('link', { name: /Ada Brews/ })).toBeTruthy();
    expect(dialog.textContent).toContain('bo');
    fireEvent.click(screen.getByRole('link', { name: /Ada Brews/ }));
    expect(await screen.findByText('at /friends/f1?tab=collection')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so and points at /friends when there are no friends', async () => {
    listFriends.mockResolvedValue([]);
    await openPicker();
    expect(await screen.findByText('No friends yet.')).toBeTruthy();
    const find = screen.getAllByRole('link', { name: 'Find a friend to trade with' });
    fireEvent.click(find[find.length - 1]);
    expect(await screen.findByText('at /friends')).toBeTruthy();
  });

  it('the no-trades empty state starts a trade through the same picker', async () => {
    listFriends.mockResolvedValue([friend('f1', 'ada', 'Ada Brews')]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Start a trade' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(await screen.findByRole('link', { name: /Ada Brews/ })).toBeTruthy();
  });

  it('shows an error with a retry when friends fail to load', async () => {
    listFriends.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([friend('f1', 'ada')]);
    await openPicker();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByRole('link', { name: /ada/ })).toBeTruthy());
  });

  it('Cancel closes the picker', async () => {
    listFriends.mockResolvedValue([friend('f1', 'ada')]);
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
