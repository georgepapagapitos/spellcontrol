// @vitest-environment happy-dom
/**
 * Your own deck reached through its public link (Discover, a rail, your
 * profile) has to land on your deck page, not the stranger's-eye `/d/:slug`
 * view — that URL reads as somebody else's deck.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchPublicDeckPageMock, recordDeckViewMock } = vi.hoisted(() => ({
  fetchPublicDeckPageMock: vi.fn(),
  recordDeckViewMock: vi.fn(),
}));
vi.mock('../lib/share-client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/share-client')>();
  return {
    ...real,
    fetchPublicDeckPage: fetchPublicDeckPageMock,
    recordDeckView: recordDeckViewMock,
  };
});
vi.mock('../components/share/SharedDeckSurface', () => ({
  SharedDeckSurface: () => <div>public deck surface</div>,
}));
vi.mock('../lib/use-ownership-lens', () => ({
  useOwnershipLens: () => ({
    lens: null,
    missingCost: null,
    missingCardPrices: new Map(),
    loading: false,
  }),
}));

import { PublicDeckPage } from './PublicDeckPage';
import { useAuth } from '../store/auth';
import { useDecksStore } from '../store/decks';
import type { Deck } from '../store/decks';

const DECK_ID = 'deck_0990c97b';

function signIn(username: string | null) {
  useAuth.setState({
    user: username ? { id: 'u1', username, role: 'user' } : null,
    status: username ? 'authed' : 'guest',
    error: null,
    autoLinkedAt: null,
    profile: null,
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/d/queen-marchesa-1c9fe196']}>
      <Routes>
        <Route path="/d/:slug" element={<PublicDeckPage />} />
        <Route path="/decks/:id" element={<div>deck editor</div>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  fetchPublicDeckPageMock.mockResolvedValue({
    slug: 'queen-marchesa-1c9fe196',
    viewCount: 3,
    copyCount: 0,
    deck: { id: DECK_ID, name: 'queen marchesa', ownerUsername: 'george', cards: [] },
  });
  useDecksStore.setState({
    hydrated: true,
    decks: [{ id: DECK_ID, name: 'queen marchesa' } as Deck],
  });
});

afterEach(() => {
  fetchPublicDeckPageMock.mockReset();
  recordDeckViewMock.mockReset();
  useDecksStore.setState({ hydrated: false, decks: [] });
});

describe('PublicDeckPage — the owner never sees the visitor view', () => {
  it('redirects the owner to their own deck page', async () => {
    signIn('george');
    renderPage();
    expect(await screen.findByText('deck editor')).toBeTruthy();
  });

  it('keeps the public page for the owner when that deck is not on this device', async () => {
    signIn('george');
    useDecksStore.setState({ hydrated: true, decks: [] });
    renderPage();
    expect(await screen.findByText('public deck surface')).toBeTruthy();
  });

  it('keeps the public page for everyone else', async () => {
    signIn('someone-else');
    renderPage();
    expect(await screen.findByText('public deck surface')).toBeTruthy();
  });
});
