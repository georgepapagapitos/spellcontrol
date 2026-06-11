// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ScannerQueueSheet, type ScannedEntry } from './ScannerQueueSheet';
import type { ScryfallCard } from '@/deck-builder/types';

const fetchPrintingsMock = vi.fn();
vi.mock('../lib/api', () => ({
  fetchPrintings: (name: string) => fetchPrintingsMock(name),
}));

const searchCardsMock = vi.fn();
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: (...args: unknown[]) => searchCardsMock(...args),
}));

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'card-1',
    oracle_id: 'oracle-bolt',
    name: 'Lightning Bolt',
    cmc: 1,
    type_line: 'Instant',
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    prices: { usd: '1.50' },
    legalities: { commander: 'legal' },
    image_uris: {
      small: 'https://example.test/bolt-lea-small.jpg',
      normal: '',
      large: '',
      png: '',
      art_crop: '',
      border_crop: '',
    },
    ...overrides,
  } as ScryfallCard;
}

function makeEntry(over: Partial<ScannedEntry> = {}): ScannedEntry {
  return {
    id: 'oracle-bolt',
    card: makeCard(),
    qty: 2,
    finish: 'nonfoil',
    rawText: 'Lightning Bolt',
    ...over,
  };
}

describe('ScannerQueueSheet', () => {
  beforeEach(() => {
    fetchPrintingsMock.mockReset();
    searchCardsMock.mockReset();
    searchCardsMock.mockResolvedValue({ data: [], has_more: false });
  });

  it('shows the empty state when the queue is empty', () => {
    render(
      <ScannerQueueSheet
        entries={[]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    expect(screen.getByText(/Nothing scanned yet/)).toBeTruthy();
  });

  it('renders a row per entry with name, set·CN, and quantity', () => {
    render(
      <ScannerQueueSheet
        entries={[makeEntry()]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    expect(screen.getByText('Lightning Bolt')).toBeTruthy();
    expect(screen.getByText(/LEA · 161/)).toBeTruthy();
    expect(screen.getByText('2', { selector: '.scanner-qty-value' })).toBeTruthy();
  });

  it('fires qty/remove callbacks', () => {
    const onChangeQty = vi.fn();
    const onRemove = vi.fn();
    render(
      <ScannerQueueSheet
        entries={[makeEntry()]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={onChangeQty}
        onChangeFinish={vi.fn()}
        onRemove={onRemove}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText(/Increase quantity of Lightning Bolt/));
    expect(onChangeQty).toHaveBeenCalledWith('oracle-bolt', 1);
    fireEvent.click(screen.getByLabelText(/Decrease quantity of Lightning Bolt/));
    expect(onChangeQty).toHaveBeenCalledWith('oracle-bolt', -1);
    fireEvent.click(screen.getByLabelText(/Remove Lightning Bolt/));
    expect(onRemove).toHaveBeenCalledWith('oracle-bolt');
  });

  it('disables decrement at qty 1', () => {
    render(
      <ScannerQueueSheet
        entries={[makeEntry({ qty: 1 })]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    const dec = screen.getByLabelText(/Decrease quantity of Lightning Bolt/) as HTMLButtonElement;
    expect(dec.disabled).toBe(true);
  });

  it('lazily fetches printings when the picker opens and swaps on select', async () => {
    const altPrint = makeCard({
      id: 'card-2',
      set: '2ed',
      set_name: 'Unlimited Edition',
      collector_number: '174',
    });
    fetchPrintingsMock.mockResolvedValue([makeCard(), altPrint]);
    const onChangePrinting = vi.fn();
    render(
      <ScannerQueueSheet
        entries={[makeEntry()]}
        onClose={vi.fn()}
        onChangePrinting={onChangePrinting}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText(/Change printing of Lightning Bolt/));
    expect(fetchPrintingsMock).toHaveBeenCalledWith('Lightning Bolt');
    await waitFor(() => expect(screen.getByText(/Unlimited Edition/)).toBeTruthy());
    fireEvent.click(screen.getByText(/2ED · 174/));
    expect(onChangePrinting).toHaveBeenCalledWith('oracle-bolt', altPrint);
  });

  it('clear-all confirms before firing, and continue-scanning plays the exit then closes', async () => {
    const onClearAll = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <ScannerQueueSheet
        entries={[makeEntry()]}
        onClose={onClose}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={onClearAll}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    // Clear all now opens a confirmation dialog rather than wiping immediately.
    fireEvent.click(screen.getByText('Clear all'));
    expect(onClearAll).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Clear scanned cards?' });
    fireEvent.click(within(dialog).getByText('Clear all'));
    // handleClearAll awaits the confirm promise, so onClearAll fires a tick later.
    await waitFor(() => expect(onClearAll).toHaveBeenCalled());
    // Continue scanning routes through the symmetric exit: onClose only
    // fires once the scanner-sheet-slide-out animation ends.
    fireEvent.click(screen.getByText('Continue scanning'));
    expect(onClose).not.toHaveBeenCalled();
    const panel = container.querySelector('.scanner-sheet-panel') as HTMLElement;
    expect(panel.className).toContain('is-closing');
    fireEvent.animationEnd(panel, { animationName: 'scanner-sheet-slide-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Every dismiss path goes through the symmetric exit — it flips
  // `is-closing` on panel + backdrop and fires onClose only when the
  // `scanner-sheet-slide-out` animation ends (not synchronously).
  const renderForDismiss = (onClose: () => void) =>
    render(
      <ScannerQueueSheet
        entries={[makeEntry()]}
        onClose={onClose}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );

  it('dismisses via the ✕ button (exit class → animationend → onClose)', () => {
    const onClose = vi.fn();
    const { container } = renderForDismiss(onClose);
    fireEvent.click(screen.getByLabelText('Close scanned cards'));
    expect(onClose).not.toHaveBeenCalled(); // exit animation in flight
    const panel = container.querySelector('.scanner-sheet-panel') as HTMLElement;
    expect(panel.className).toContain('is-closing');
    expect(container.querySelector('.scanner-sheet-backdrop')?.className).toContain('is-closing');
    // The entry animation ending must NOT unmount the sheet.
    fireEvent.animationEnd(panel, { animationName: 'scanner-sheet-slide' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(panel, { animationName: 'scanner-sheet-slide-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses via the backdrop and via Escape through the same exit', () => {
    const onClose = vi.fn();
    const { container } = renderForDismiss(onClose);
    fireEvent.click(container.querySelector('.scanner-sheet-backdrop') as Element);
    fireEvent.keyDown(document, { key: 'Escape' }); // double-trigger guard
    const panel = container.querySelector('.scanner-sheet-panel') as HTMLElement;
    expect(panel.className).toContain('is-closing');
    fireEvent.animationEnd(panel, { animationName: 'scanner-sheet-slide-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reduced motion closes immediately without waiting on the exit animation', () => {
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList
    );
    try {
      const onClose = vi.fn();
      renderForDismiss(onClose);
      fireEvent.click(screen.getByLabelText('Close scanned cards'));
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('shows an Add-N-cards CTA in the footer and fires onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <ScannerQueueSheet
        entries={[makeEntry({ qty: 3 })]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={onConfirm}
        onAddCard={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Add 3 cards'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('toggles finish when the printing has a foil variant', () => {
    const onChangeFinish = vi.fn();
    const foilable = makeEntry({
      card: makeCard({
        finishes: ['nonfoil', 'foil'],
        prices: { usd: '1.50', usd_foil: '6.00' } as ScryfallCard['prices'],
      }),
    });
    render(
      <ScannerQueueSheet
        entries={[foilable]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={onChangeFinish}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    // nonfoil → shows the foil price fallback chain at nonfoil ($1.50).
    expect(screen.getByText('$1.50')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Finish of Lightning Bolt: Normal/));
    expect(onChangeFinish).toHaveBeenCalledWith('oracle-bolt', 'foil');
  });

  it('hides the finish toggle when the printing has no foil variant', () => {
    render(
      <ScannerQueueSheet
        entries={[makeEntry({ card: makeCard({ finishes: ['nonfoil'] }) })]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    expect(screen.queryByLabelText(/Finish of Lightning Bolt/)).toBeNull();
  });

  it('shows the foil price once the row finish is foil', () => {
    render(
      <ScannerQueueSheet
        entries={[
          makeEntry({
            finish: 'foil',
            card: makeCard({
              finishes: ['nonfoil', 'foil'],
              prices: { usd: '1.50', usd_foil: '6.00' } as ScryfallCard['prices'],
            }),
          }),
        ]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    expect(screen.getByText('$6.00')).toBeTruthy();
  });

  it('opens a row printing picker on mount when initialPickerFor is set', async () => {
    fetchPrintingsMock.mockResolvedValue([makeCard()]);
    render(
      <ScannerQueueSheet
        entries={[makeEntry()]}
        initialPickerFor="oracle-bolt"
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    await waitFor(() => expect(fetchPrintingsMock).toHaveBeenCalledWith('Lightning Bolt'));
  });

  it('searches Scryfall and adds a result to the queue', async () => {
    const counterspell = makeCard({
      id: 'card-cs',
      oracle_id: 'oracle-cs',
      name: 'Counterspell',
      set: 'lea',
      collector_number: '54',
    });
    searchCardsMock.mockResolvedValue({ data: [counterspell], has_more: false });
    const onAddCard = vi.fn();
    render(
      <ScannerQueueSheet
        entries={[]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={onAddCard}
      />
    );

    // Typing fewer than two characters doesn't query.
    fireEvent.change(screen.getByLabelText(/Search Scryfall to add a card/), {
      target: { value: 'c' },
    });
    expect(searchCardsMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Search Scryfall to add a card/), {
      target: { value: 'counter' },
    });
    const addBtn = await screen.findByLabelText('Add Counterspell');
    fireEvent.click(addBtn);
    expect(onAddCard).toHaveBeenCalledWith(counterspell);
  });

  it('surfaces a no-matches message when the search comes back empty', async () => {
    render(
      <ScannerQueueSheet
        entries={[]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onChangeFinish={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
        onConfirm={vi.fn()}
        onAddCard={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/Search Scryfall to add a card/), {
      target: { value: 'zzzznotacard' },
    });
    await waitFor(() => expect(screen.getByText('No matches.')).toBeTruthy());
  });
});
