// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from './AdminPage';
import { useAuth } from '../store/auth';
import type { BeaconRows } from '../lib/admin-api';

// Only the Analytics tab's own fetch is exercised; the rest of the page's
// network (AdminPanel) and the wipe path are stubbed.
const listEventsMock = vi.fn<() => Promise<BeaconRows>>();
vi.mock('../lib/admin-api', () => ({ listEvents: () => listEventsMock() }));
vi.mock('../components/AdminPanel', () => ({ AdminPanel: () => null }));
vi.mock('../lib/sync', () => ({ stopSyncAndWipeLocal: vi.fn() }));

const empty: BeaconRows = { events: [], errors: [], vitals: [] };

describe('AdminPage — Analytics tab load states (playtest batch 12)', () => {
  beforeEach(() => {
    listEventsMock.mockReset();
    useAuth.setState({
      user: { id: 'admin-1', username: 'dev', role: 'admin' } as never,
      status: 'authed',
    });
  });

  it('a failed first load is not sticky: the data shows once a later fetch succeeds', async () => {
    listEventsMock
      .mockRejectedValueOnce(new Error('Beacon store is offline.'))
      .mockResolvedValueOnce(empty);
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );
    await screen.findByText('Beacon store is offline.');
    // Leaving and returning re-fetches (events is still null) — the error
    // must clear when that fetch lands.
    fireEvent.click(screen.getByRole('tab', { name: 'Local checks' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }));
    await screen.findByText('Analytics (last 30 days)');
    await waitFor(() => expect(screen.queryByText('Beacon store is offline.')).toBeNull());
    expect(listEventsMock).toHaveBeenCalledTimes(2);
  });

  it('the error state has a Retry that fetches again', async () => {
    listEventsMock
      .mockRejectedValueOnce(new Error('Beacon store is offline.'))
      .mockResolvedValueOnce(empty);
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    );
    await screen.findByText('Beacon store is offline.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Analytics (last 30 days)');
    expect(screen.queryByText('Beacon store is offline.')).toBeNull();
    expect(listEventsMock).toHaveBeenCalledTimes(2);
  });
});
