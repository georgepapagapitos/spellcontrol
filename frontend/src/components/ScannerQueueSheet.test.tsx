// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ScannerQueueSheet } from './ScannerQueueSheet';
import type { ScannedEntry } from '../lib/use-scan-queue';
import type { ScryfallCard } from '@/deck-builder/types';

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
    finishes: ['nonfoil', 'foil'],
    image_uris: {
      small: 'https://example.test/bolt-small.jpg',
      normal: 'https://example.test/bolt-normal.jpg',
      large: '',
      png: '',
      art_crop: '',
      border_crop: '',
    },
    ...overrides,
  } as ScryfallCard;
}

const bolt: ScannedEntry = {
  id: 'card-1::nonfoil',
  card: makeCard(),
  qty: 2,
  finish: 'nonfoil',
  rawText: 'Lightning Bolt',
  addedAt: 1000,
};
const greaves: ScannedEntry = {
  id: 'card-2::nonfoil',
  card: makeCard({
    id: 'card-2',
    oracle_id: 'oracle-greaves',
    name: 'Lightning Greaves',
    set: 'soc',
    set_name: 'Secrets of Strixhaven Commander',
    collector_number: '350',
    prices: { usd: '4.98' },
  }),
  qty: 1,
  finish: 'nonfoil',
  condition: 'lp',
  rawText: 'Lightning Greaves',
  addedAt: 2000,
};

function renderSheet(entries: ScannedEntry[] = [bolt, greaves]) {
  const props = {
    entries,
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    onClearAll: vi.fn(),
    onChangeFinish: vi.fn(),
    onChangeCondition: vi.fn(),
    onAddCard: vi.fn(),
    onConfirm: vi.fn(),
  };
  render(<ScannerQueueSheet {...props} />);
  return props;
}

const rowNames = () =>
  [...document.querySelectorAll('.scan-row .scan-row-name')].map((n) =>
    n.textContent?.replace(/\s+/g, ' ').trim()
  );

describe('ScannerQueueSheet', () => {
  beforeEach(() => {
    searchCardsMock.mockReset();
    searchCardsMock.mockResolvedValue({ data: [], has_more: false });
  });

  it('opens above the full-screen scanner, as a bottom sheet on a phone', () => {
    renderSheet();
    const backdrop = document.querySelector('.modal-backdrop');
    // --over-sheet lifts it past the camera's --z-overlay; without it the sheet
    // (and any confirm) would open behind the camera.
    expect(backdrop?.classList.contains('modal-backdrop--over-sheet')).toBe(true);
    expect(backdrop?.classList.contains('modal-backdrop--sheet')).toBe(true);
  });

  it('shows an empty state, with adding to the collection off until something is scanned', () => {
    renderSheet([]);
    expect(screen.getByText('No cards scanned yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add cards' }).hasAttribute('disabled')).toBe(true);
  });

  it('lists rows newest first with count, set, finish, condition and the row value', () => {
    renderSheet();
    expect(screen.getByRole('heading', { name: '3 cards scanned' })).toBeTruthy();
    expect(screen.getByText('$7.98 total')).toBeTruthy();
    expect(rowNames()).toEqual(['1× Lightning Greaves', '2× Lightning Bolt']);
    const boltRow = screen.getByRole('button', { name: /Edit 2 Lightning Bolt/ });
    expect(within(boltRow).getByText('Limited Edition Alpha · #161')).toBeTruthy();
    expect(within(boltRow).getByText('Normal')).toBeTruthy();
    expect(within(boltRow).getByText('NM')).toBeTruthy();
    // Two copies at $1.50: the row shows what the stack is worth.
    expect(within(boltRow).getByText('$3.00')).toBeTruthy();
  });

  it('opens a row for editing and removes one with its own button', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: /Edit 2 Lightning Bolt/ }));
    expect(props.onEdit).toHaveBeenCalledWith('card-1::nonfoil');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Lightning Greaves' }));
    expect(props.onRemove).toHaveBeenCalledWith(['card-2::nonfoil']);
  });

  it('adds the whole list, or goes back to scanning', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 cards' }));
    expect(props.onConfirm).toHaveBeenCalledWith();
    fireEvent.click(screen.getByRole('button', { name: 'Keep scanning' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('filters the list by card or set name', () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText('Filter scanned cards'), {
      target: { value: 'strixhaven' },
    });
    expect(rowNames()).toEqual(['1× Lightning Greaves']);
    fireEvent.change(screen.getByLabelText('Filter scanned cards'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/No scanned cards match/)).toBeTruthy();
  });

  it('sorts by price from the ⋮ menu', () => {
    renderSheet([greaves, { ...bolt, addedAt: 5000, card: makeCard({ prices: { usd: '0.10' } }) }]);
    expect(rowNames()[0]).toBe('2× Lightning Bolt');
    fireEvent.click(screen.getByRole('button', { name: 'More list actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sort by price' }));
    expect(rowNames()[0]).toBe('1× Lightning Greaves');
  });

  it('clears the list from the ⋮ menu only after a confirm that stacks above the scanner', async () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'More list actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear the list' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear 3 cards?' });
    expect(props.onClearAll).not.toHaveBeenCalled();
    // The confirm used to open on the plain modal tier, underneath the camera.
    expect(
      dialog.closest('.modal-backdrop')?.classList.contains('modal-backdrop--over-sheet')
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(props.onClearAll).toHaveBeenCalled());
  });

  describe('select mode', () => {
    function enterSelect() {
      fireEvent.click(screen.getByRole('button', { name: 'More list actions' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Select cards' }));
    }

    it('picks rows with checkboxes and adds only those', () => {
      const props = renderSheet();
      enterSelect();
      const boxes = screen.getAllByRole('checkbox');
      expect(boxes).toHaveLength(2);
      fireEvent.click(boxes[1]); // the bolt row (newest first)
      expect(screen.getByRole('heading', { name: '2 cards selected' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Add 2 cards' }));
      expect(props.onConfirm).toHaveBeenCalledWith(['card-1::nonfoil']);
    });

    it('asks before removing the selection', async () => {
      const props = renderSheet();
      enterSelect();
      screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b));
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      const dialog = await screen.findByRole('dialog', { name: 'Remove 3 cards?' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
      await waitFor(() =>
        expect(props.onRemove).toHaveBeenCalledWith(['card-1::nonfoil', 'card-2::nonfoil'])
      );
    });

    it('edits the selection together', () => {
      const props = renderSheet();
      enterSelect();
      screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b));
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit 3 cards' });
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Foil' }));
      expect(props.onChangeFinish).toHaveBeenCalledWith(
        ['card-1::nonfoil', 'card-2::nonfoil'],
        'foil'
      );
    });

    it('turns the actions off until something is picked, and Done leaves the mode', () => {
      renderSheet();
      enterSelect();
      expect(screen.getByRole('button', { name: 'Add 0 cards' }).hasAttribute('disabled')).toBe(
        true
      );
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });
  });

  describe('adding a card by name', () => {
    it('searches every card and adds a result to the list', async () => {
      const counterspell = makeCard({ id: 'card-cs', name: 'Counterspell', set_name: 'Alpha' });
      searchCardsMock.mockResolvedValue({ data: [counterspell], has_more: false });
      const props = renderSheet();
      fireEvent.click(screen.getByRole('button', { name: 'Add by name' }));

      const input = screen.getByLabelText('Search all cards to add one');
      fireEvent.change(input, { target: { value: 'c' } });
      expect(searchCardsMock).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: 'counter' } });

      fireEvent.click(await screen.findByRole('button', { name: 'Add Counterspell, Alpha' }));
      expect(props.onAddCard).toHaveBeenCalledWith(counterspell);
      expect(screen.getByText('Added')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(screen.getByLabelText('Filter scanned cards')).toBeTruthy();
    });

    it('says so when nothing matches', async () => {
      renderSheet([]);
      fireEvent.click(screen.getByRole('button', { name: 'Add by name' }));
      fireEvent.change(screen.getByLabelText('Search all cards to add one'), {
        target: { value: 'zzzznotacard' },
      });
      await waitFor(() => expect(screen.getByText(/No cards match/)).toBeTruthy());
    });
  });
});
