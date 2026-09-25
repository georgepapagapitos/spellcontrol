// @vitest-environment happy-dom
/**
 * The per-draft format picker on the batch-review step (E423 lane G): it used
 * to be a native <select>, now SelectMenu. Covers that the control is a menu
 * button + listbox (not a native select) and that picking an option calls
 * through to changeDraftFormat with the right value.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckImportResponse } from '../../types';

vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => vi.fn() };
});

vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[] }) => unknown) => sel({ decks: [] }),
}));

vi.mock('../../lib/build-deck-from-import', () => ({
  useBuildDeckFromImport: () => vi.fn(),
}));

const importDeckFileMock = vi.fn<() => Promise<DeckImportResponse>>();
vi.mock('../../lib/api', () => ({
  importDeckText: vi.fn(),
  importDeckFile: () => importDeckFileMock(),
}));

vi.mock('../../lib/sync', () => ({
  isOnline: () => true,
  onSyncedChange: () => () => {},
}));

vi.mock('./CommanderSearch', () => ({ CommanderSearch: () => null }));

import { ImportDeckDialog } from './ImportDeckDialog';

const PARSED: DeckImportResponse = {
  commander: null,
  companion: null,
  cards: [],
  unresolvedNames: [],
  fetchErrors: [],
  detectedFormat: '',
  cardCount: 0,
};

function renderDialog() {
  return render(
    <MemoryRouter>
      <ImportDeckDialog onClose={vi.fn()} />
    </MemoryRouter>
  );
}

/** Stages one file and advances from the input step into the batch-review step. */
async function reachBatchStep() {
  renderDialog();
  const file = new File(['4 Lightning Bolt'], 'my-deck.txt', { type: 'text/plain' });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });
  fireEvent.click(await screen.findByRole('button', { name: /Continue \(1 file\)/ }));
  await waitFor(() => expect(screen.getByLabelText('Format for my-deck')).toBeTruthy());
}

beforeEach(() => {
  importDeckFileMock.mockReset().mockResolvedValue(PARSED);
});
afterEach(() => localStorage.clear());

describe('ImportDeckDialog — per-draft format picker', () => {
  it('renders the format control as a menu button, not a native <select>', async () => {
    await reachBatchStep();
    const trigger = screen.getByLabelText('Format for my-deck');
    expect(trigger.tagName).toBe('BUTTON');
    expect(document.querySelector('select')).toBeNull();
  });

  it('opens a listbox of every format and picking one updates the shown value', async () => {
    await reachBatchStep();
    const trigger = screen.getByLabelText('Format for my-deck');
    expect(trigger.textContent).toMatch(/Commander/);

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: 'Standard' }));

    await waitFor(() => expect(trigger.textContent).toMatch(/Standard/));
  });
});
