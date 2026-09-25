// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const useDeckCombos = vi.fn();
vi.mock('../../lib/use-deck-combos', () => ({
  useDeckCombos: (args: unknown) => useDeckCombos(args),
}));
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('../CardPreview', () => ({ CardPreview: () => null }));
vi.mock('../../store/collection', () => ({
  useCollectionStore: (sel: (s: unknown) => unknown) => sel({ cards: [] }),
}));
vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: unknown) => unknown) => sel({ decks: [] }),
}));

import { DeckCombosPanel } from './DeckCombosPanel';

const refetch = vi.fn();

function renderPanel(over: { loading?: boolean; error?: string | null } = {}) {
  useDeckCombos.mockReturnValue({
    data: null,
    loading: over.loading ?? false,
    error: over.error ?? null,
    refetch,
  });
  return render(
    <DeckCombosPanel
      deckId="deck-1"
      deckOracleIds={['o1']}
      format="commander"
      onAdd={() => {}}
      embedded
    />
  );
}

describe('DeckCombosPanel error state', () => {
  beforeEach(() => {
    useDeckCombos.mockReset();
    refetch.mockReset();
  });

  it('offers a Retry that re-runs the match, matching the collection page', () => {
    renderPanel({ error: 'Combos are taking too long to load. Try again.' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Combos are taking too long to load. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('disables Retry and says so while the retry is in flight', () => {
    renderPanel({ error: 'Combos are taking too long to load. Try again.', loading: true });
    const btn = screen.getByRole('button', { name: 'Retrying…' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('renders no Retry when there is no error', () => {
    renderPanel();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

// The deck page hands the panel the match its hero and bracket already use.
// With a second match of its own, a Retry here refreshed only the panel: the
// hero kept "Couldn't reach combos" and the bracket stayed a floor.
describe("DeckCombosPanel with the caller's combo match", () => {
  beforeEach(() => {
    useDeckCombos.mockReset();
    refetch.mockReset();
    useDeckCombos.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
  });

  it("shows the caller's result, runs no match of its own, and retries the caller's", () => {
    const callerRefetch = vi.fn();
    render(
      <DeckCombosPanel
        deckId="deck-1"
        deckOracleIds={['o1']}
        format="commander"
        embedded
        combos={{
          data: null,
          loading: false,
          error: "Couldn't load combos.",
          refetch: callerRefetch,
        }}
      />
    );
    expect(useDeckCombos).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load combos.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(callerRefetch).toHaveBeenCalledTimes(1);
  });

  it('runs its own match when the caller passes none (the shared deck page)', () => {
    renderPanel();
    expect(useDeckCombos).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });
});
