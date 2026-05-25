// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScannerQueueSheet, type ScannedEntry } from './ScannerQueueSheet';
import type { ScryfallCard } from '@/deck-builder/types';

const fetchPrintingsMock = vi.fn();
vi.mock('../lib/api', () => ({
  fetchPrintings: (name: string) => fetchPrintingsMock(name),
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
    rawText: 'Lightning Bolt',
    ...over,
  };
}

describe('ScannerQueueSheet', () => {
  beforeEach(() => {
    fetchPrintingsMock.mockReset();
  });

  it('shows the empty state when the queue is empty', () => {
    render(
      <ScannerQueueSheet
        entries={[]}
        onClose={vi.fn()}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
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
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
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
        onRemove={onRemove}
        onClearAll={vi.fn()}
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
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
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
        onRemove={vi.fn()}
        onClearAll={vi.fn()}
      />
    );
    fireEvent.click(screen.getByLabelText(/Change printing of Lightning Bolt/));
    expect(fetchPrintingsMock).toHaveBeenCalledWith('Lightning Bolt');
    await waitFor(() => expect(screen.getByText(/Unlimited Edition/)).toBeTruthy());
    fireEvent.click(screen.getByText(/2ED · 174/));
    expect(onChangePrinting).toHaveBeenCalledWith('oracle-bolt', altPrint);
  });

  it('clear-all and continue-scanning fire their callbacks', () => {
    const onClearAll = vi.fn();
    const onClose = vi.fn();
    render(
      <ScannerQueueSheet
        entries={[makeEntry()]}
        onClose={onClose}
        onChangePrinting={vi.fn()}
        onChangeQty={vi.fn()}
        onRemove={vi.fn()}
        onClearAll={onClearAll}
      />
    );
    fireEvent.click(screen.getByText('Clear all'));
    expect(onClearAll).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Continue scanning'));
    expect(onClose).toHaveBeenCalled();
  });
});
