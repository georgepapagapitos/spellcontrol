// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScannerEditSheet } from './ScannerEditSheet';
import type { ScannedEntry } from '../lib/use-scan-queue';
import type { ScryfallCard } from '@/deck-builder/types';
import { useCollectionStore } from '../store/collection';

const fetchPrintingsMock = vi.fn();
vi.mock('../lib/api', () => ({
  fetchPrintings: (name: string, set?: string) => fetchPrintingsMock(name, set),
}));

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'geyser-5dn',
    oracle_id: 'oracle-geyser',
    name: 'Mana Geyser',
    cmc: 5,
    type_line: 'Sorcery',
    color_identity: ['R'],
    keywords: [],
    rarity: 'common',
    set: '5dn',
    set_name: 'Fifth Dawn',
    collector_number: '75',
    prices: { usd: '2.25', usd_foil: '28.60' },
    legalities: { commander: 'legal' },
    finishes: ['nonfoil', 'foil'],
    image_uris: {
      small: '',
      normal: 'https://example.test/geyser.jpg',
      large: '',
      png: '',
      art_crop: '',
      border_crop: '',
    },
    ...overrides,
  } as ScryfallCard;
}

const entry: ScannedEntry = {
  id: 'geyser-5dn::nonfoil',
  card: makeCard(),
  qty: 1,
  finish: 'nonfoil',
  rawText: 'Mana Geyser',
};

function renderEdit(e: ScannedEntry = entry) {
  const props = {
    entry: e,
    onClose: vi.fn(),
    onFinish: vi.fn(),
    onCondition: vi.fn(),
    onQty: vi.fn(),
    onPrinting: vi.fn(),
    onRemove: vi.fn(),
  };
  render(<ScannerEditSheet {...props} />);
  return props;
}

describe('ScannerEditSheet', () => {
  beforeEach(() => {
    fetchPrintingsMock.mockReset();
    useCollectionStore.setState({ cards: [] });
  });

  it('shows the price and how many you already own', () => {
    useCollectionStore.setState({
      cards: [
        { name: 'Mana Geyser', oracleId: 'oracle-geyser' },
        { name: 'Mana Geyser', oracleId: 'oracle-geyser' },
        { name: 'Sol Ring', oracleId: 'oracle-sol' },
      ] as never,
    });
    renderEdit();
    expect(document.querySelector('.scanner-edit-price')?.textContent).toContain('$2.25');
    expect(screen.getByText('You own 2 already')).toBeTruthy();
  });

  it('offers each finish the printing has, with its price, and applies a pick at once', () => {
    const props = renderEdit();
    const foil = screen.getByRole('radio', { name: 'Foil, $28.60' });
    expect(screen.getByRole('radio', { name: 'Normal, $2.25' })).toBeTruthy();
    fireEvent.click(foil);
    expect(props.onFinish).toHaveBeenCalledWith('foil');
  });

  it('hides the finish choice for a printing with only one', () => {
    renderEdit({ ...entry, card: makeCard({ finishes: ['nonfoil'] }) });
    expect(screen.queryByRole('radio', { name: /Foil/ })).toBeNull();
  });

  it('steps the quantity, never below one', () => {
    const props = renderEdit();
    expect(screen.getByRole('button', { name: 'One fewer' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'One more' }));
    expect(props.onQty).toHaveBeenCalledWith(1);
  });

  it('removes the card, and Done closes', () => {
    const props = renderEdit();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(props.onRemove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('shows the card full size on a tap', () => {
    renderEdit();
    const img = screen.getByRole('button', { name: 'Show the card full size' });
    fireEvent.click(img);
    expect(img.getAttribute('aria-expanded')).toBe('true');
  });

  it('chooses a printing from every printing of the card, not just the scanned set', async () => {
    const c21 = makeCard({
      id: 'geyser-c21',
      set: 'c21',
      set_name: 'Commander 2021',
      collector_number: '176',
    });
    // The server lists the scanned printing second; the grid leads with it.
    fetchPrintingsMock.mockResolvedValue([c21, makeCard()]);
    const props = renderEdit();

    fireEvent.click(screen.getByRole('button', { name: /^Printing: Fifth Dawn/ }));
    expect(fetchPrintingsMock).toHaveBeenCalledWith('Mana Geyser', undefined);
    expect(await screen.findByText('2 printings of Mana Geyser')).toBeTruthy();
    const first = document.querySelector('.scan-printing button');
    expect(first?.getAttribute('aria-label')).toBe('Fifth Dawn number 75, current');
    expect(first?.getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Commander 2021 number 176' }));
    expect(props.onPrinting).toHaveBeenCalledWith(c21);
    // Picking returns to the card.
    expect(screen.getByRole('heading', { name: 'Mana Geyser' })).toBeTruthy();
  });

  it('offers a retry when the printings fail to load', async () => {
    fetchPrintingsMock.mockRejectedValueOnce(new Error('offline'));
    fetchPrintingsMock.mockResolvedValueOnce([makeCard()]);
    renderEdit();
    fireEvent.click(screen.getByRole('button', { name: /^Printing: Fifth Dawn/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('1 printing of Mana Geyser')).toBeTruthy());
  });
});
