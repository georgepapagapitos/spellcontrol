// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ScannedEntry } from '../lib/use-scan-queue';

// Heavy dependencies are stubbed: each is exercised by its own test
// suite. AddCardsSheet's job is the tab strip + tab-panel routing + the
// scan launcher, which is what these tests cover.
vi.mock('./AddCardSearchPanel', () => ({
  AddCardSearchPanel: () => <div data-testid="search-panel">search</div>,
}));

vi.mock('./UploadPanel', () => ({
  UploadPanel: (props: { hideScanButton?: boolean }) => (
    <div data-testid="upload-panel" data-hide-scan={String(!!props.hideScanButton)}>
      upload
    </div>
  ),
}));

vi.mock('./ProductSearchPanel', () => ({
  ProductSearchPanel: () => <div data-testid="product-panel">products</div>,
}));

vi.mock('./CardScanner', () => ({
  CardScanner: ({
    onConfirm,
    onClose,
  }: {
    onConfirm: (text: string, count: number) => void;
    onClose: () => void;
  }) => (
    <div data-testid="card-scanner">
      <button data-testid="scanner-confirm" onClick={() => onConfirm('1 Forest', 1)}>
        confirm
      </button>
      <button data-testid="scanner-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock('../lib/use-lock-body-scroll', () => ({
  useLockBodyScroll: () => {},
}));

vi.mock('../lib/use-can-scan', () => ({
  useCanScan: vi.fn(() => true),
}));

const importTextMock = vi.fn(async (_text: string) => ({
  cards: [{ name: 'Forest' }],
  unresolvedNames: [],
  fetchErrors: [],
  scryfallHits: 1,
  format: 'mtga',
}));
vi.mock('../lib/api', () => ({
  importText: (text: string) => importTextMock(text),
}));

const importCardsMock = vi.fn(async (..._args: unknown[]) => 'import-id');
const deleteImportsMock = vi.fn(async (..._args: unknown[]) => undefined);
const collectionState = {
  importCards: importCardsMock,
  deleteImports: deleteImportsMock,
  cards: [] as unknown[],
  binders: [] as unknown[],
};
function useCollectionStoreMock(selector: (s: typeof collectionState) => unknown) {
  return selector(collectionState);
}
useCollectionStoreMock.getState = () => collectionState;
vi.mock('../store/collection', () => ({
  useCollectionStore: useCollectionStoreMock,
}));

import { AddCardsSheet } from './AddCardsSheet';
import { useCanScan } from '../lib/use-can-scan';
import { useScanQueueStore } from '../lib/use-scan-queue';

beforeEach(() => {
  importTextMock.mockClear();
  importCardsMock.mockClear();
  deleteImportsMock.mockClear();
  collectionState.cards = [];
  collectionState.binders = [];
  useScanQueueStore.setState({ queue: [] });
  vi.mocked(useCanScan).mockReturnValue(true);
});

describe('AddCardsSheet', () => {
  it('defaults to the Search tab', () => {
    render(<AddCardsSheet onClose={() => {}} />);
    expect(screen.getByRole('tab', { name: /Search/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('search-panel')).toBeTruthy();
    // Other panels stay mounted so in-flight state survives tab switches,
    // but are hidden — the `hidden` attribute keeps them out of the
    // accessibility tree.
    const uploadPanel = screen.getByTestId('upload-panel').closest('[role="tabpanel"]');
    expect(uploadPanel?.hasAttribute('hidden')).toBe(true);
  });

  it('switches to the Add-from-list tab and reveals the upload panel', () => {
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /Add from list/ }));
    expect(screen.getByRole('tab', { name: /Add from list/ }).getAttribute('aria-selected')).toBe(
      'true'
    );
    const uploadPanel = screen.getByTestId('upload-panel').closest('[role="tabpanel"]');
    expect(uploadPanel?.hasAttribute('hidden')).toBe(false);
  });

  it('switches to the Products tab and reveals the product panel', () => {
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /Products/ }));
    expect(screen.getByRole('tab', { name: /Products/ }).getAttribute('aria-selected')).toBe(
      'true'
    );
    const panel = screen.getByTestId('product-panel').closest('[role="tabpanel"]');
    expect(panel?.hasAttribute('hidden')).toBe(false);
  });

  it('passes hideScanButton to UploadPanel so the Scan tab is the only entry point', () => {
    render(<AddCardsSheet onClose={() => {}} />);
    expect(screen.getByTestId('upload-panel').getAttribute('data-hide-scan')).toBe('true');
  });

  it('hides the Scan tab on devices without scan capability', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    render(<AddCardsSheet onClose={() => {}} />);
    expect(screen.queryByRole('tab', { name: /Scan/ })).toBeNull();
  });

  it('falls back to Search when initialTab=scan but scan is unsupported', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    render(<AddCardsSheet onClose={() => {}} initialTab="scan" />);
    expect(screen.getByRole('tab', { name: /Search/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('launches the scanner from the Scan tab and merges the result on confirm', async () => {
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /Scan/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start scanning/ }));

    // Scanner appears (async because CardScanner is lazy-loaded); user confirms.
    fireEvent.click(await screen.findByTestId('scanner-confirm'));

    // Wait a tick for the async confirm handler.
    await Promise.resolve();
    await Promise.resolve();

    expect(importTextMock).toHaveBeenCalledWith('1 Forest');
    // Scanned cards are always merged — the mode dialog only matters for
    // file/paste flows that might want replace / import-as-binder.
    expect(importCardsMock).toHaveBeenCalledWith(
      expect.objectContaining({ cards: expect.any(Array) }),
      'scanned-cards',
      'merge'
    );
  });

  it('closes the scanner without importing when the user cancels', async () => {
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /Scan/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start scanning/ }));
    fireEvent.click(await screen.findByTestId('scanner-close'));
    expect(screen.queryByTestId('card-scanner')).toBeNull();
    expect(importCardsMock).not.toHaveBeenCalled();
  });

  // Dismissal routes through the symmetric pop-out exit (useSheetExit):
  // is-closing goes on the modal + backdrop, and onClose fires only when
  // the modal-panel-out animation ends.
  it('plays the exit animation on Escape, then fires onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<AddCardsSheet onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled(); // exit animation in flight
    const modal = container.querySelector('.add-cards-modal') as HTMLElement;
    expect(modal.className).toContain('is-closing');
    expect(container.querySelector('.add-cards-backdrop')?.className).toContain('is-closing');
    fireEvent.animationEnd(modal, { animationName: 'modal-panel-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens Add settings from the header gear', async () => {
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Add settings'));
    // The sheet is lazy-loaded (its stylesheet stays out of this page's
    // eager chunk — css-chunk-ownership.test.ts).
    expect(
      await screen.findByRole('heading', { name: 'Add settings' }, { timeout: 5000 })
    ).toBeTruthy();
  });

  it('hides the Scanner section of Add settings on a device that cannot scan', async () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Add settings'));
    expect(
      await screen.findByRole('heading', { name: 'Add settings' }, { timeout: 5000 })
    ).toBeTruthy();
    expect(screen.queryByText('Sound on each scan')).toBeNull();
  });

  it('dismisses via the ✕ button and the backdrop through the same exit', () => {
    const onClose = vi.fn();
    const { container } = render(<AddCardsSheet onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    fireEvent.click(container.querySelector('.add-cards-backdrop') as Element); // guard: no double-close
    const modal = container.querySelector('.add-cards-modal') as HTMLElement;
    expect(modal.className).toContain('is-closing');
    fireEvent.animationEnd(modal, { animationName: 'modal-panel-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AddCardsSheet Add list (T153)', () => {
  function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
    return {
      id: 'print-1',
      oracle_id: 'oracle-1',
      name: 'Sol Ring',
      set: 'cmr',
      set_name: 'Commander Legends',
      collector_number: '472',
      prices: { usd: '2.00' },
      finishes: ['nonfoil', 'foil'],
      image_uris: {
        small: '',
        normal: '',
        large: '',
        png: '',
        art_crop: '',
        border_crop: '',
      },
      ...overrides,
    } as ScryfallCard;
  }

  function seedAddList(entries: ScannedEntry[]) {
    useScanQueueStore.setState({ queue: entries });
  }

  const solRing: ScannedEntry = {
    id: 'print-1::nonfoil',
    card: makeCard(),
    qty: 2,
    finish: 'nonfoil',
    rawText: 'Sol Ring',
    source: 'searched',
  };

  it('shows the bar with count and value only when the list has items', () => {
    const { rerender } = render(<AddCardsSheet onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();

    seedAddList([solRing]);
    rerender(<AddCardsSheet onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
    expect(screen.getByText('2 cards')).toBeTruthy();
    expect(screen.getByText('$4.00')).toBeTruthy();
  });

  it('commits from the bar: one importCards call, clears the list, shows the routing summary', async () => {
    seedAddList([solRing]);
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }));

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock).toHaveBeenCalledWith(
      expect.objectContaining({ cards: expect.any(Array) }),
      'add-list',
      'merge'
    );
    expect(useScanQueueStore.getState().queue).toEqual([]);
    expect(await screen.findByText('Added to your collection')).toBeTruthy();
    // The mock's importText always resolves one card regardless of qty
    // requested, which is exactly the added !== requested branch.
    expect(screen.getByText('Added 1 of 2 card')).toBeTruthy();
  });

  it('labels an all-scanned batch scanned-cards, even when committed from the bar', async () => {
    seedAddList([{ ...solRing, source: 'scanned' }]);
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }));
    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock).toHaveBeenCalledWith(expect.anything(), 'scanned-cards', 'merge');
  });

  it('Undo removes exactly that import', async () => {
    seedAddList([solRing]);
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add 2' }));
    await screen.findByText('Added to your collection');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(deleteImportsMock).toHaveBeenCalledWith(['import-id']);
  });

  it('opens the review sheet, which stacks above the Add-cards sheet and commits the same way', async () => {
    seedAddList([solRing]);
    render(<AddCardsSheet onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog', { name: '2 cards' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 2 cards' }));
    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(useScanQueueStore.getState().queue).toEqual([]);
  });

  it('the list survives the sheet closing and reopening', () => {
    seedAddList([solRing]);
    const { unmount } = render(<AddCardsSheet onClose={() => {}} />);
    expect(screen.getByText('2 cards')).toBeTruthy();
    unmount();
    render(<AddCardsSheet onClose={() => {}} />);
    expect(screen.getByText('2 cards')).toBeTruthy();
  });
});
