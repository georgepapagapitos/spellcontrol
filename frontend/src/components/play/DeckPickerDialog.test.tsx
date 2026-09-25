// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeckPickerDialog } from './DeckPickerDialog';
import type { Deck } from '../../store/decks';
import type { ProductSummary } from '../../types';

const searchProducts = vi.fn();
const fetchProductCommanderSummary = vi.fn();

vi.mock('../../lib/api', () => ({
  searchProducts: (...args: unknown[]) => searchProducts(...args),
  fetchProductCommanderSummary: (...args: unknown[]) => fetchProductCommanderSummary(...args),
}));

// The rows enrich themselves when they near the viewport; happy-dom has no
// layout, so the hook's no-IntersectionObserver path is what runs here.
const NO_IO = undefined;

// The commander-summary cache is module-level on purpose (it spans surfaces),
// so every test gets its own file names — a name another test already looked
// up would answer from the cache instead of from this test's mock.
let nth = 0;
function product(name: string, fileName = `${name}-${++nth}.json`): ProductSummary {
  return { fileName, code: 'xyz', name, type: 'Commander Deck', releaseDate: '2026-01-01' };
}

function deck(over: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Atraxa',
    cards: [],
    updatedAt: 0,
    commander: { name: 'Atraxa, Praetors’ Voice', color_identity: ['W', 'U', 'B', 'G'] },
    ...over,
  } as unknown as Deck;
}

function open(props: Partial<React.ComponentProps<typeof DeckPickerDialog>> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <DeckPickerDialog decks={[deck()]} value={null} onPick={onPick} onClose={onClose} {...props} />
  );
  return { onPick, onClose };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  searchProducts.mockResolvedValue([product('Squirreled Away'), product('Grave Danger')]);
  fetchProductCommanderSummary.mockResolvedValue({
    name: 'Hazel of the Rootbloom',
    colorIdentity: ['G', 'W'],
    image: null,
  });
  vi.stubGlobal('IntersectionObserver', NO_IO);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  searchProducts.mockReset();
  fetchProductCommanderSummary.mockReset();
});

describe('which tab opens', () => {
  it('opens on your decks when you have some', () => {
    open();
    expect(screen.getByRole('tab', { name: /My decks/ }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  // The whole point of the starter catalog: the account with no decks is the
  // one that most needs something to play, so it lands there.
  it('opens on the starters when you have no decks', () => {
    open({ decks: [] });
    expect(screen.getByRole('tab', { name: 'Starter decks' }).getAttribute('aria-selected')).toBe(
      'true'
    );
  });

  it('offers no tabs at all in starters-only mode', () => {
    open({ startersOnly: true });
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Pick a starter deck' })).toBeTruthy();
  });
});

describe('your own decks', () => {
  it('picks a deck and closes, carrying what a seat needs', () => {
    const { onPick, onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: /Atraxa/ }));
    expect(onPick).toHaveBeenCalledWith({
      id: 'deck-1',
      name: 'Atraxa',
      commander: 'Atraxa, Praetors’ Voice',
      partner: null,
      colorIdentity: ['W', 'U', 'B', 'G'],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('filters by name and by commander', () => {
    open({ decks: [deck(), deck({ id: 'd2', name: 'Goblins', commander: undefined })] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by deck name' }), {
      target: { value: 'praetors' },
    });
    expect(screen.getByRole('button', { name: /Atraxa/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Goblins/ })).toBeNull();
  });

  it('says so when nothing matches, rather than showing an empty list', () => {
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search by deck name' }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No deck of yours matches that.')).toBeTruthy();
  });

  it('offers a way back to no deck once one is picked', () => {
    const { onPick } = open({ value: 'deck-1' });
    fireEvent.click(screen.getByRole('button', { name: 'No deck' }));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it('needs two decks before a randomizer means anything', () => {
    open();
    expect(
      screen.getByRole('button', { name: 'Pick a random deck' }).hasAttribute('disabled')
    ).toBe(true);
  });

  it('shows the estimate alongside a stated bracket that differs (2026-09-24 ruling)', () => {
    open({
      decks: [
        deck({
          id: 'd2',
          name: 'Sandbagged',
          bracketOverride: 2,
          bracketEstimation: { bracket: 4 } as Deck['bracketEstimation'],
        }),
      ],
    });
    expect(screen.getByText('Bracket 2 · est. 4')).toBeTruthy();
  });

  it('shows only the stated bracket when it matches the estimate', () => {
    open({
      decks: [
        deck({
          id: 'd2',
          name: 'Matched',
          bracketOverride: 3,
          bracketEstimation: { bracket: 3 } as Deck['bracketEstimation'],
        }),
      ],
    });
    expect(screen.getByText('Bracket 3')).toBeTruthy();
    expect(screen.queryByText(/est\./)).toBeNull();
  });
});

describe('the starter catalog', () => {
  const openStarters = (props: Partial<React.ComponentProps<typeof DeckPickerDialog>> = {}) =>
    open({ startersOnly: true, ...props });

  it('lists the newest precons before anything is typed', async () => {
    openStarters();
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Squirreled Away/ })).toBeTruthy()
    );
    expect(searchProducts).toHaveBeenCalledWith('', 'Commander Deck');
  });

  it('searches the catalog on the server, debounced', async () => {
    openStarters();
    await vi.advanceTimersByTimeAsync(400);
    searchProducts.mockClear();
    const box = screen.getByRole('textbox', { name: 'Search by deck name' });
    fireEvent.change(box, { target: { value: 'sq' } });
    fireEvent.change(box, { target: { value: 'squirrel' } });
    expect(searchProducts).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(searchProducts).toHaveBeenCalledTimes(1);
    expect(searchProducts).toHaveBeenCalledWith('squirrel', 'Commander Deck');
  });

  // A starter's commander is what the rest of the table sees on the roster,
  // so it is resolved before the pick lands — never dispatched as null.
  it('resolves the commander before handing the pick back', async () => {
    searchProducts.mockResolvedValue([product('Squirreled Away', 'squirreled.json')]);
    const { onPick } = openStarters();
    await vi.advanceTimersByTimeAsync(400);
    fireEvent.click(await screen.findByRole('button', { name: /Squirreled Away/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick).toHaveBeenCalledWith({
      id: 'starter:squirreled.json',
      name: 'Squirreled Away',
      commander: 'Hazel of the Rootbloom',
      partner: null,
      colorIdentity: ['G', 'W'],
    });
  });

  it('still picks when the commander lookup fails', async () => {
    // A distinct file name: the summary cache is module-level on purpose, so a
    // name another test already enriched would answer from it.
    searchProducts.mockResolvedValue([product('Unlooked-up', 'no-commander.json')]);
    fetchProductCommanderSummary.mockRejectedValue(new Error('Failed to fetch'));
    const { onPick } = openStarters();
    await vi.advanceTimersByTimeAsync(400);
    fireEvent.click(await screen.findByRole('button', { name: /Unlooked-up/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0]).toMatchObject({ commander: null, colorIdentity: [] });
  });

  it('says the catalog is unreachable instead of showing an empty one', async () => {
    searchProducts.mockRejectedValue(new Error('Failed to fetch'));
    openStarters();
    await vi.advanceTimersByTimeAsync(400);
    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't load the starter decks"
    );
  });

  it('says so when a search matches nothing', async () => {
    searchProducts.mockResolvedValue([]);
    openStarters();
    await vi.advanceTimersByTimeAsync(400);
    expect(await screen.findByText('No starter deck matches that.')).toBeTruthy();
  });

  it('rolls a random starter', async () => {
    const { onPick } = openStarters();
    await vi.advanceTimersByTimeAsync(400);
    await screen.findByRole('button', { name: /Squirreled Away/ });
    fireEvent.click(screen.getByRole('button', { name: 'Pick a random deck' }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][0].id).toMatch(/^starter:/);
  });
});
