// @vitest-environment happy-dom
/**
 * "Friends who own this": one lookup per card (cached for the session), Ask
 * writes the draft then opens the review, and every state is a quiet line.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FriendOwner } from '@/lib/social/friends-client';
import { useAuth } from '@/store/auth';
import { useTradeDraftsStore } from '@/store/trade-drafts';
import { clearFriendOwnersCache, FriendOwnersPanel, renderFriendOwners } from './FriendOwnersPanel';

const fetchFriendOwners = vi.fn<(oracleId: string) => Promise<FriendOwner[]>>();
vi.mock('@/lib/social/friends-client', () => ({
  fetchFriendOwners: (id: string) => fetchFriendOwners(id),
}));

const ana: FriendOwner = {
  friendId: 'f1',
  username: 'ana',
  displayName: 'Ana',
  count: 3,
  spare: true,
};
const bo: FriendOwner = {
  friendId: 'f2',
  username: 'bo',
  displayName: null,
  count: 1,
  spare: false,
};

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
function wrap(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      {ui}
      <Where />
    </MemoryRouter>
  );
}

beforeEach(() => {
  clearFriendOwnersCache();
  fetchFriendOwners.mockReset();
  useTradeDraftsStore.setState({ drafts: {} });
  useAuth.setState({ user: { id: 'me', username: 'me', role: 'user' } as never });
});

describe('FriendOwnersPanel', () => {
  it('lists owners in server order and caches per oracle', async () => {
    fetchFriendOwners.mockResolvedValue([bo, ana]);
    const { rerender } = wrap(<FriendOwnersPanel oracleId="o1" cardName="Sol Ring" />);
    await screen.findByText('Ana');
    const names = Array.from(document.body.querySelectorAll('.friend-owners-name')).map(
      (n) => n.textContent
    );
    expect(names).toEqual(['bo', 'Ana']);
    expect(document.body.textContent).toContain('3 · spare');
    expect(document.body.textContent).toContain('1 · not spare');

    rerender(
      <MemoryRouter>
        <FriendOwnersPanel oracleId="o2" cardName="Other" />
      </MemoryRouter>
    );
    fetchFriendOwners.mockResolvedValue([ana]);
    await waitFor(() => expect(fetchFriendOwners).toHaveBeenCalledTimes(2));
    rerender(
      <MemoryRouter>
        <FriendOwnersPanel oracleId="o1" cardName="Sol Ring" />
      </MemoryRouter>
    );
    await screen.findByText('Ana');
    expect(fetchFriendOwners).toHaveBeenCalledTimes(2);
  });

  it('Ask writes the draft capped at the owner count and opens the review', async () => {
    fetchFriendOwners.mockResolvedValue([bo]);
    wrap(<FriendOwnersPanel oracleId="o1" cardName="Sol Ring" />);
    const btn = await screen.findByRole('button', { name: 'Ask bo for Sol Ring' });
    fireEvent.click(btn);
    const d = useTradeDraftsStore.getState().getDraft('me', 'f2');
    expect(d?.friendName).toBe('bo');
    expect(d?.get.o1).toEqual({ name: 'Sol Ring', quantity: 1 });
    expect(screen.getByTestId('where').textContent).toBe('/friends/f2?tab=collection&review=1');

    // A second Ask cannot exceed the one copy they own.
    fireEvent.click(btn);
    expect(useTradeDraftsStore.getState().getDraft('me', 'f2')?.get.o1.quantity).toBe(1);
  });

  it('shows the none line', async () => {
    fetchFriendOwners.mockResolvedValue([]);
    wrap(<FriendOwnersPanel oracleId="o1" cardName="Sol Ring" />);
    expect(await screen.findByText('None of your friends have this.')).toBeTruthy();
  });

  it('shows a quiet error and retries', async () => {
    fetchFriendOwners.mockRejectedValueOnce(new Error('x'));
    wrap(<FriendOwnersPanel oracleId="o1" cardName="Sol Ring" />);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fetchFriendOwners.mockResolvedValue([ana]);
    fireEvent.click(retry);
    await screen.findByText('Ana');
    expect(fetchFriendOwners).toHaveBeenCalledTimes(2);
  });

  it('renders nothing and never fetches when signed out', () => {
    useAuth.setState({ user: null });
    wrap(<FriendOwnersPanel oracleId="o1" cardName="Sol Ring" />);
    expect(document.body.textContent).not.toContain('Friends who own this');
    expect(fetchFriendOwners).not.toHaveBeenCalled();
  });
});

describe('renderFriendOwners (the collection and want-list renderPanelExtra)', () => {
  it('renders the panel for a card with an oracle id and nothing without one', async () => {
    fetchFriendOwners.mockResolvedValue([ana]);
    wrap(<>{renderFriendOwners({ oracleId: 'o1', name: 'Sol Ring' })}</>);
    await screen.findByText('Ana');
    expect(renderFriendOwners({ name: 'No Oracle' })).toBeNull();
    expect(renderFriendOwners(undefined)).toBeNull();
  });
});
