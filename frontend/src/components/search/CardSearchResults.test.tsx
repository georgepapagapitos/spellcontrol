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

vi.mock('@/lib/search/use-search-cards', () => ({
  useSearchCards: () => ({ results: [RESULT], loading: false, error: null, total: null }),
}));

import { AddCardSearchPanel } from '@/components/import/AddCardSearchPanel';
import { InlineCardSearch } from './InlineCardSearch';
import { CardSearchResults } from './CardSearchResults';
import { useCollectionStore } from '@/store/collection';
import { entryKey, useScanQueueStore } from '@/lib/scanner/use-scan-queue';
import { useScannerSettings } from '@/lib/scanner/scanner-settings';

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

  // A "+" drawn on the art grew to 44px on touch and covered the card's mana
  // cost (E453). The "+", the printing and the owned count live in a caption
  // under the art; nothing but the image sits inside the preview button.
  it('keeps the add button and the counts in a caption, off the art', async () => {
    useCollectionStore.setState({
      cards: [
        { copyId: 'a', name: 'Sol Ring' },
        { copyId: 'b', name: 'Sol Ring' },
      ] as never,
    });
    const { container } = render(<CardSearchResults results={[RESULT]} view="grid" />);
    await act(async () => {});

    const art = screen.getByRole('button', { name: 'Preview Sol Ring' });
    const caption = container.querySelector('.inline-card-search-tile-caption');
    expect(caption).toBeTruthy();
    expect(art.contains(screen.getByRole('button', { name: 'Add Sol Ring' }))).toBe(false);
    expect(caption!.contains(screen.getByRole('button', { name: 'Add Sol Ring' }))).toBe(true);
    expect(caption!.textContent).toContain('LTR #123');
    expect(caption!.textContent).toContain('You own 2');
    expect(art.textContent).toBe('');
  });
});

describe('CardSearchResults keyboard nav handle', () => {
  it('moveActive/addActive drive the row the same way ↑/↓/Enter would', async () => {
    useCollectionStore.setState({ cards: [] as never });
    const addCard = vi.fn(async (..._a: unknown[]) => ['c1']);
    useCollectionStore.setState({ addCard });

    const second: ScryfallCard = { ...RESULT, id: 'row-parity-2', name: 'Ash Barrens' };
    const ref = {
      current: null as import('@/lib/search/use-results-keys').CardSearchResultsHandle | null,
    };
    render(<CardSearchResults ref={ref} results={[RESULT, second]} />);
    await act(async () => {});

    act(() => ref.current?.moveActive(1));
    act(() => ref.current?.addActive());

    await vi.waitFor(() => expect(addCard).toHaveBeenCalledTimes(1));
    expect(addCard.mock.calls[0][0]).toMatchObject({ name: 'Ash Barrens' });
  });
});

describe('CardSearchResults addToList (T153 Add-list target)', () => {
  afterEach(() => {
    useScanQueueStore.setState({ queue: [] });
    useScannerSettings.setState({
      defaultFinish: 'nonfoil',
      defaultCondition: 'nm',
      defaultLanguage: '',
    });
  });

  it('"+" adds to the Add list, not the collection, with no toast/undo affordance', async () => {
    const addCard = vi.fn(async (..._a: unknown[]) => ['c1']);
    useCollectionStore.setState({ cards: [] as never, addCard });

    render(<CardSearchResults results={[RESULT]} addToList />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add Sol Ring' }));

    expect(addCard).not.toHaveBeenCalled();
    expect(useScanQueueStore.getState().queue).toMatchObject([
      { id: entryKey('row-parity', 'nonfoil'), qty: 1, source: 'searched' },
    ]);
    // No collection toast/undo minus icon for a list add.
    expect(screen.queryByText(/Added ×/)).toBeNull();
  });

  it('tapping again increments via a −/+ stepper instead of a second "+"', async () => {
    render(<CardSearchResults results={[RESULT]} addToList />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add Sol Ring' }));
    expect(await screen.findByRole('button', { name: 'One more Sol Ring' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Sol Ring' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'One more Sol Ring' }));
    expect(useScanQueueStore.getState().queue[0].qty).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: 'One fewer Sol Ring' }));
    expect(useScanQueueStore.getState().queue[0].qty).toBe(1);
  });

  it('announces the add in a polite live region', async () => {
    render(<CardSearchResults results={[RESULT]} addToList />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add Sol Ring' }));
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('Added Sol Ring to the add list, 1 card');
  });

  it('the printing picker adds its explicit finish/condition/language/qty to the list', async () => {
    render(<CardSearchResults results={[RESULT]} addToList />);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /Printing/ }));
    const foil = await screen.findByRole('radio', { name: /Foil/ });
    fireEvent.click(foil);
    fireEvent.click(document.querySelector('.inline-card-search-add-printing')!);

    expect(useScanQueueStore.getState().queue).toMatchObject([
      { id: entryKey('row-parity', 'foil'), finish: 'foil', qty: 1, source: 'searched' },
    ]);
  });
});

describe('CardSearchResults onActiveChange / hideRowDisclosure (T153 phase 4, desktop workbench)', () => {
  const second: ScryfallCard = { ...RESULT, id: 'row-parity-2', name: 'Ash Barrens' };

  it('fires with the top result on mount, with no hover or keyboard nav yet', async () => {
    const onActiveChange = vi.fn();
    render(<CardSearchResults results={[RESULT, second]} onActiveChange={onActiveChange} />);
    await act(async () => {});
    expect(onActiveChange).toHaveBeenLastCalledWith(RESULT);
  });

  it('follows the row the pointer hovers', async () => {
    const onActiveChange = vi.fn();
    render(<CardSearchResults results={[RESULT, second]} onActiveChange={onActiveChange} />);
    await act(async () => {});
    onActiveChange.mockClear();

    fireEvent.mouseEnter(screen.getByText('Ash Barrens').closest('li')!);
    expect(onActiveChange).toHaveBeenLastCalledWith(second);
  });

  it('follows moveActive (the same keyboard nav AddCardSearchPanel drives)', async () => {
    const onActiveChange = vi.fn();
    const ref = {
      current: null as import('@/lib/search/use-results-keys').CardSearchResultsHandle | null,
    };
    render(
      <CardSearchResults ref={ref} results={[RESULT, second]} onActiveChange={onActiveChange} />
    );
    await act(async () => {});
    onActiveChange.mockClear();

    act(() => ref.current?.moveActive(1));
    expect(onActiveChange).toHaveBeenLastCalledWith(second);
  });

  it('fires null once the result set empties', async () => {
    const onActiveChange = vi.fn();
    const { rerender } = render(
      <CardSearchResults results={[RESULT]} onActiveChange={onActiveChange} />
    );
    await act(async () => {});
    onActiveChange.mockClear();

    rerender(<CardSearchResults results={[]} onActiveChange={onActiveChange} />);
    await act(async () => {});
    expect(onActiveChange).toHaveBeenLastCalledWith(null);
  });

  it('hides the per-row "Printing & finish" disclosure when hideRowDisclosure is set', async () => {
    render(<CardSearchResults results={[RESULT]} hideRowDisclosure />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: /Printing/ })).toBeNull();
  });
});
