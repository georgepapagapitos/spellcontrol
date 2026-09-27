// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImportHistorySheet } from './ImportHistorySheet';
import { useCollectionStore } from '../store/collection';

const ENTRY_A = { id: 'imp1', name: 'collection.csv', count: 5, format: 'manabox', addedAt: 1000 };
const ENTRY_B = {
  id: 'imp2',
  name: 'archidekt-export.csv',
  count: 3,
  format: 'archidekt',
  addedAt: 2000,
};
// A pre-per-import-delete row: no id, so it can't be individually selected.
const LEGACY_ENTRY = { id: '', name: 'old-upload.csv', count: 10, format: 'plain', addedAt: 500 };

beforeEach(() => {
  useCollectionStore.setState({
    cards: [],
    importHistory: [],
    isLoading: false,
  });
});

describe('ImportHistorySheet (T153 — moved off the add-cards flow)', () => {
  it('shows an empty state when there is no history', () => {
    render(<ImportHistorySheet onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Import history' })).toBeTruthy();
    expect(screen.getByText('No imports recorded for this collection.')).toBeTruthy();
  });

  it('lists every import, most recent first, with count and format', () => {
    useCollectionStore.setState({ importHistory: [ENTRY_A, ENTRY_B] });
    render(<ImportHistorySheet onClose={() => {}} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toContain('archidekt-export.csv');
    expect(rows[1].textContent).toContain('collection.csv');
    expect(screen.getByText(/3 cards/)).toBeTruthy();
  });

  it('disables the checkbox for a legacy row with no id and says why', () => {
    useCollectionStore.setState({ importHistory: [LEGACY_ENTRY] });
    render(<ImportHistorySheet onClose={() => {}} />);
    const checkbox = screen.getByRole('checkbox', { name: /old-upload.csv/ }) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('deletes the selected imports with a confirm that is honest about Undo', async () => {
    useCollectionStore.setState({
      cards: [{ copyId: 'c1', scryfallId: 'sf1', name: 'Sol Ring', importId: 'imp1' }] as never,
      importHistory: [ENTRY_A, ENTRY_B],
    });
    render(<ImportHistorySheet onClose={() => {}} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /collection.csv/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }));

    const heading = screen.getByRole('heading', { name: 'Delete 1 import?' });
    const dialog = heading.closest('[role="dialog"]') as HTMLElement;
    // Truthful about Undo — deleteImports() always follows with a toast
    // offering one, so the old "This can't be undone" contradicted it.
    expect(within(dialog).getByText(/You can undo from the toast/)).toBeTruthy();
    expect(within(dialog).queryByText(/This can't be undone/)).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(useCollectionStore.getState().importHistory).toEqual([ENTRY_B]));
    expect(useCollectionStore.getState().cards).toEqual([]);
  });

  it('cancelling the delete confirm keeps the import', () => {
    useCollectionStore.setState({ importHistory: [ENTRY_A] });
    render(<ImportHistorySheet onClose={() => {}} />);

    fireEvent.click(screen.getByRole('checkbox', { name: /collection.csv/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('heading', { name: 'Delete 1 import?' })).toBeNull();
    expect(useCollectionStore.getState().importHistory).toEqual([ENTRY_A]);
  });

  it('shows Done, not a delete action, until something is selected', () => {
    useCollectionStore.setState({ importHistory: [ENTRY_A] });
    render(<ImportHistorySheet onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.queryByText(/Delete selected/)).toBeNull();
  });
});
