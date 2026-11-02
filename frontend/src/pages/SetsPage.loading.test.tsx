// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetsPage } from './SetsPage';
import { useCollectionStore } from '../store/collection';
import { useAuth } from '../store/auth';
import { pending } from '@/test/pending';

let mapState: 'pending' | 'ready' = 'ready';
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  useSetMap: () => (mapState === 'ready' ? SET_MAP : undefined),
  getSetMap: () => (mapState === 'ready' ? Promise.resolve(SET_MAP) : pending(SET_MAP)),
}));
const SET_MAP = {};

afterEach(cleanup);

const renderSets = () =>
  render(
    <MemoryRouter>
      <SetsPage />
    </MemoryRouter>
  );

// The Sets tab painted "No sets to track yet." for a frame on every visit while
// the collection hydrated, and the short page parked the footer mid-screen
// before the sets shoved it away (CLS 0.15 on desktop, E1049).
describe('SetsPage while the collection loads', () => {
  it('shows the collection loader, not the empty state, while hydrating', () => {
    mapState = 'ready';
    useAuth.setState({ status: 'guest' });
    useCollectionStore.setState({ hydrating: true, cards: [] });
    renderSets();
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Loading your collection…');
    expect(status.classList.contains('page-loader')).toBe(true);
    expect(screen.queryByText('No sets to track yet.')).toBeNull();
  });

  it('shows the empty state once a guest collection has loaded empty', () => {
    mapState = 'ready';
    useAuth.setState({ status: 'guest' });
    useCollectionStore.setState({ hydrating: false, cards: [] });
    renderSets();
    expect(screen.getByText('No sets to track yet.')).toBeTruthy();
  });

  // Rows painted before the set list came back were re-sorted, gained totals and
  // meter bars, and shoved the page down (CLS 0.28 on phone, E1086).
  it('holds the loader, not set rows, until the set list has arrived', () => {
    mapState = 'pending';
    useAuth.setState({ status: 'guest' });
    useCollectionStore.setState({
      hydrating: false,
      cards: [{ copyId: 'a', scryfallId: 's', setCode: 'CMR', collectorNumber: '1' } as never],
    });
    renderSets();
    expect(screen.getByRole('status').classList.contains('page-loader')).toBe(true);
    expect(document.querySelector('.sets-list')).toBeNull();
  });
});
