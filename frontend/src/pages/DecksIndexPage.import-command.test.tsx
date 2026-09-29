// @vitest-environment happy-dom
/**
 * The command palette's "Import deck" (lib/search/commands.ts) sends
 * `navigate('/decks', { state: { openImport: true } })`. DecksIndexPage used to
 * ignore that state, so the command only ever opened the Decks page. Guards:
 * the dialog opens on arrival, opens when the command fires while the page is
 * already mounted, and closing drops the flag so Back doesn't reopen it.
 */
import 'fake-indexeddb/auto';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../store/decks', () => ({
  useDecksStore: (
    sel: (s: { decks: unknown[]; deleteDeck: () => void; deleteAllDecks: () => void }) => unknown
  ) => sel({ decks: [], deleteDeck: vi.fn(), deleteAllDecks: vi.fn() }),
}));
vi.mock('../components/deck/ImportDeckDialog', () => ({
  ImportDeckDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="import-dialog">
      <button onClick={onClose}>Close import</button>
    </div>
  ),
}));
vi.mock('@/components/import/ProductSearchDialog', () => ({ ProductSearchDialog: () => null }));
vi.mock('@/components/share/ShareDialog', () => ({ ShareDialog: () => null }));
vi.mock('@/components/overlays/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/components/decks/DeckFiltersPopover', () => ({ DeckFiltersPopover: () => null }));
vi.mock('@/lib/deck/deck-validation', () => ({
  effectiveDeckColors: () => [],
  deckDisplayColors: () => [],
  validateDeckZones: () => ({ deck: [], sideboardOnly: [] }),
  countFlaggedCards: () => 0,
}));
vi.mock('../deck-builder/services/scryfall/client', () => ({ getCardPrice: () => null }));

import { DecksIndexPage } from './DecksIndexPage';

/** Prints the current location state and offers the palette's navigation. */
function Harness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="state">{JSON.stringify(location.state ?? null)}</output>
      <button onClick={() => navigate('/decks', { state: { openImport: true } })}>
        Palette import
      </button>
      <DecksIndexPage />
    </>
  );
}

function renderAt(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/decks', state }]}>
      <Routes>
        <Route path="/decks" element={<Harness />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('DecksIndexPage — the palette opens Import deck', () => {
  beforeEach(() => localStorage.clear());

  it('opens the import dialog when it arrives with openImport, and closing drops the flag', () => {
    renderAt({ openImport: true });
    expect(screen.getByTestId('import-dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Close import'));
    expect(screen.queryByTestId('import-dialog')).toBeNull();
    // Replaced in history, so Back can't reopen it.
    expect(screen.getByTestId('state').textContent).toBe('null');
  });

  it('stays closed on a plain visit', () => {
    renderAt(null);
    expect(screen.queryByTestId('import-dialog')).toBeNull();
  });

  it('opens when the command fires while the page is already open', () => {
    renderAt(null);
    expect(screen.queryByTestId('import-dialog')).toBeNull();
    act(() => {
      fireEvent.click(screen.getByText('Palette import'));
    });
    expect(screen.getByTestId('import-dialog')).toBeTruthy();
    fireEvent.click(screen.getByText('Close import'));
    expect(screen.queryByTestId('import-dialog')).toBeNull();
  });
});
