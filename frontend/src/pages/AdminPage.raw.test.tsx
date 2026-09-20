// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from './AdminPage';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { useDecksStore } from '../store/decks';
import { useToastsStore } from '../store/toasts';
import type { BeaconRows } from '../lib/admin-api';

// Only the Raw JSON / Local data tabs are exercised here; Analytics and
// AdminPanel's own network are stubbed (mirrors AdminPage.analytics.test.tsx).
const listEventsMock = vi.fn<() => Promise<BeaconRows>>(() =>
  Promise.resolve({ events: [], errors: [], vitals: [] })
);
vi.mock('../lib/admin-api', () => ({ listEvents: () => listEventsMock() }));
vi.mock('../components/AdminPanel', () => ({ AdminPanel: () => null }));
vi.mock('../lib/sync', () => ({ stopSyncAndWipeLocal: vi.fn() }));

const writeText = vi.fn(async () => {});
const toastMessages = () => useToastsStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  writeText.mockClear();
  useToastsStore.setState({ toasts: [] });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  useAuth.setState({
    user: { id: 'admin-1', username: 'dev', role: 'admin' } as never,
    status: 'authed',
  });
  useCollectionStore.setState({
    cards: [],
    binders: [],
    hydrating: false,
    importHistory: [
      {
        id: 'imp-1',
        name: 'binder.csv',
        count: 12,
        format: 'manabox',
        addedAt: Date.parse('2026-09-18T00:00:00Z'),
      },
    ],
  } as never);
  useDecksStore.setState({ decks: [] } as never);
});

function openTab(label: string) {
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('tab', { name: label }));
}

describe('AdminPage — Raw JSON copy feedback (E349, playtest batch 12)', () => {
  it('toasts on a successful copy', async () => {
    openTab('Raw JSON');
    fireEvent.click(screen.getByRole('button', { name: 'Copy decks JSON' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await waitFor(() => expect(toastMessages()).toContain('Copied decks JSON.'));
  });

  it('toasts an error when the clipboard write rejects', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    openTab('Raw JSON');
    fireEvent.click(screen.getByRole('button', { name: 'Copy binders JSON' }));
    await waitFor(() => expect(toastMessages()).toContain("Couldn't copy to the clipboard."));
  });
});

describe('AdminPage — Local data imports summary (E350, playtest batch 12)', () => {
  it('drops the dishonest "Most recent file" line; the table speaks for itself', () => {
    openTab('Local data');
    expect(screen.queryByText(/Most recent file/)).toBeNull();
    expect(screen.getByText('binder.csv')).toBeTruthy();
  });
});
