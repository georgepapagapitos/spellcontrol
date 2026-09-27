// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';

// Both surfaces search through this hook — fixing its result lets one test
// mount AddCardSearchPanel and InlineCardSearch side by side and diff the row
// they render for the exact same card, with no network involved.
const RESULT: ScryfallCard = {
  id: 'row-parity',
  name: 'Sol Ring',
  set: 'ltr',
  set_name: 'The Lord of the Rings',
  collector_number: '123',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '1.50' },
  image_uris: { normal: 'https://cards.scryfall.io/normal/row-parity.jpg' },
} as unknown as ScryfallCard;

vi.mock('../lib/use-search-cards', () => ({
  useSearchCards: () => ({ results: [RESULT], loading: false, error: null, total: null }),
}));

import { AddCardSearchPanel } from './AddCardSearchPanel';
import { InlineCardSearch } from './InlineCardSearch';
import { CardSearchResults } from './CardSearchResults';
import { useCollectionStore } from '../store/collection';

/** Class names of the row and every descendant, in document order — the
 *  "same markup" the two surfaces must agree on. */
function rowSignature(container: HTMLElement): string {
  const row = container.querySelector('.inline-card-search-row');
  if (!row) throw new Error('no .inline-card-search-row found');
  return [row, ...row.querySelectorAll('*')].map((el) => el.className).join('|');
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('CardSearchResults row parity', () => {
  it('AddCardSearchPanel and InlineCardSearch render the identical row for the same card', async () => {
    const a = render(<AddCardSearchPanel autoFocus={false} />);
    await act(async () => {});
    const b = render(<InlineCardSearch query="sol ring" />);
    await act(async () => {});

    expect(rowSignature(a.container)).toBe(rowSignature(b.container));
  });

  it('states ownership the same way in the row and the grid tile', async () => {
    useCollectionStore.setState({
      cards: [
        { copyId: 'c1', name: 'Sol Ring' },
        { copyId: 'c2', name: 'Sol Ring' },
      ] as never,
    });

    const list = render(<CardSearchResults results={[RESULT]} view="list" />);
    await act(async () => {});
    expect(await screen.findByText('You own 2')).toBeTruthy();
    list.unmount();

    render(<CardSearchResults results={[RESULT]} view="grid" />);
    await act(async () => {});
    expect(await screen.findByText('You own 2')).toBeTruthy();
  });
});

describe('CardSearchResults grid view', () => {
  it('gives every tile a visible add button', async () => {
    useCollectionStore.setState({ cards: [] as never });
    const addCard = vi.fn(async (..._a: unknown[]) => ['c1']);
    useCollectionStore.setState({ addCard });

    render(<CardSearchResults results={[RESULT]} view="grid" />);
    await act(async () => {});

    const add = screen.getByRole('button', { name: 'Add Sol Ring' });
    fireEvent.click(add);
    await vi.waitFor(() => expect(addCard).toHaveBeenCalledTimes(1));
  });
});

describe('CardSearchResults keyboard nav handle', () => {
  it('moveActive/addActive drive the row the same way ↑/↓/Enter would', async () => {
    useCollectionStore.setState({ cards: [] as never });
    const addCard = vi.fn(async (..._a: unknown[]) => ['c1']);
    useCollectionStore.setState({ addCard });

    const second: ScryfallCard = { ...RESULT, id: 'row-parity-2', name: 'Ash Barrens' };
    const ref = { current: null as import('./CardSearchResults').CardSearchResultsHandle | null };
    render(<CardSearchResults ref={ref} results={[RESULT, second]} />);
    await act(async () => {});

    act(() => ref.current?.moveActive(1));
    act(() => ref.current?.addActive());

    await vi.waitFor(() => expect(addCard).toHaveBeenCalledTimes(1));
    expect(addCard.mock.calls[0][0]).toMatchObject({ name: 'Ash Barrens' });
  });
});
