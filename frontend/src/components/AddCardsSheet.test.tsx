// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ScryfallCard } from '@/deck-builder/types';
import type { ScannedEntry } from '../lib/use-scan-queue';

// Heavy dependencies are stubbed: each is exercised by its own test
// suite (CardSearchResults.test.tsx covers onActiveChange/hideRowDisclosure
// itself). AddCardsSheet's job is the tab strip + tab-panel routing + the
// desktop-workbench wiring (isDesktop -> hideRowDisclosure/onActiveChange ->
// AddCardInspector), which is what these tests + the ones below cover. The
// stub forwards those two props so the wiring is observable without a real
// search.
vi.mock('./AddCardSearchPanel', () => ({
  AddCardSearchPanel: (props: {
    hideRowDisclosure?: boolean;
    onActiveChange?: (card: ScryfallCard | null) => void;
  }) => (
    <div data-testid="search-panel" data-hide-row-disclosure={String(!!props.hideRowDisclosure)}>
      search
      {props.onActiveChange && (
        <button
          type="button"
          data-testid="simulate-hover"
          onClick={() => props.onActiveChange!(FAKE_CARD)}
        >
          simulate hover
        </button>
      )}
    </div>
  ),
}));

const FAKE_CARD: ScryfallCard = {
  id: 'fake-card',
  oracle_id: 'fake-oracle',
  name: 'Sol Ring',
  type_line: 'Artifact',
  set: 'cmr',
  set_name: 'Commander Legends',
  collector_number: '472',
  finishes: ['nonfoil'],
  prices: { usd: '2.00' },
  image_uris: {
    small: 'https://cards.scryfall.io/small/fake-card.jpg',
    normal: 'https://cards.scryfall.io/normal/fake-card.jpg',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
} as unknown as ScryfallCard;

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
  // The desktop inspector's PrintingPicker calls this; an empty result falls
  // back to the card it already has (its own fallback-to-[fallback] logic).
  fetchPrintings: vi.fn(async () => []),
  // Read by the Add-list commit's routing summary (E457) to match
  // BinderPage's own materialize inputs — irrelevant to what these tests
  // assert, so it resolves to nothing rather than hitting the network.
  getSetMap: vi.fn(async () => undefined),
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
  // AddCardsSheet reads the desktop-workbench tier via useMediaQuery, which
  // happy-dom doesn't implement — default to non-desktop; the workbench
  // describe block below overrides this per test.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  // The sheet renders through the shared <Modal> now (not a hand-rolled
  // backdrop): Escape starts Modal's own delayed exit — is-closing goes on
  // the backdrop, and onClose fires only once the panel's exit animation
  // ends.
  it('renders through <Modal>, and Escape plays its exit animation before firing onClose', () => {
    const onClose = vi.fn();
    render(<AddCardsSheet onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Add cards' });
    expect(dialog.className).toContain('add-cards-modal');
    // <Modal> portals to document.body, a sibling of RTL's own container.
    const backdrop = document.body.querySelector('.add-cards-backdrop') as HTMLElement;
    expect(backdrop).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled(); // exit animation in flight
    expect(backdrop.className).toContain('is-closing');

    fireEvent.animationEnd(dialog, { animationName: 'modal-panel-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses via the backdrop through the same delayed exit', () => {
    const onClose = vi.fn();
    render(<AddCardsSheet onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Add cards' });
    fireEvent.click(document.body.querySelector('.add-cards-backdrop') as Element);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.animationEnd(dialog, { animationName: 'modal-panel-out' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Per Modal's own contract (see Modal.tsx / Modal.test.tsx): a close the
  // dialog's OWN button initiates unmounts directly, no exit animation —
  // Modal reserves the animated exit for Escape/backdrop dismissal.
  it('dismisses immediately via the ✕ button, with no exit animation to wait on', () => {
    const onClose = vi.fn();
    render(<AddCardsSheet onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
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

  // The Add-list review, a row edit, the scanner and its settings all share
  // the overlay-layer stack with the sheet's own <Modal> — only the topmost
  // one answers Escape (STYLE_GUIDE § Overlays).
  it('Escape closes a stacked child (Add settings) before the sheet underneath it', async () => {
    const onClose = vi.fn();
    render(<AddCardsSheet onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Add settings'));
    const settingsDialog = await screen.findByRole(
      'dialog',
      { name: 'Add settings' },
      { timeout: 5000 }
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled(); // the sheet underneath is untouched

    fireEvent.animationEnd(settingsDialog, { animationName: 'modal-panel-out' });
    expect(screen.queryByRole('heading', { name: 'Add settings' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled(); // still hasn't propagated to the sheet
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

describe('AddCardsSheet desktop workbench (T153 phase 4)', () => {
  function setDesktop(isDesktop: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: isDesktop && query.includes('min-width: 1024px'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }

  it('below 1024px: no inspector, and the row disclosure stays', () => {
    setDesktop(false);
    render(<AddCardsSheet onClose={() => {}} />);
    expect(screen.getByTestId('search-panel').getAttribute('data-hide-row-disclosure')).toBe(
      'false'
    );
    expect(screen.queryByText('Search for a card to see it here.')).toBeNull();
  });

  it('at 1024px and up: the inspector renders (empty until a row goes active) and the row disclosure hides', () => {
    setDesktop(true);
    render(<AddCardsSheet onClose={() => {}} />);
    expect(screen.getByTestId('search-panel').getAttribute('data-hide-row-disclosure')).toBe(
      'true'
    );
    expect(screen.getByText('Search for a card to see it here.')).toBeTruthy();
  });

  it('the inspector follows the active row, and its Add button lands in the Add list', async () => {
    setDesktop(true);
    render(<AddCardsSheet onClose={() => {}} />);

    fireEvent.click(screen.getByTestId('simulate-hover'));
    expect(await screen.findByRole('heading', { name: 'Sol Ring', level: 3 })).toBeTruthy();

    await waitFor(() =>
      expect(document.querySelector('.inline-card-search-add-printing')).toBeTruthy()
    );
    fireEvent.click(document.querySelector('.inline-card-search-add-printing')!);

    expect(useScanQueueStore.getState().queue).toMatchObject([
      { id: 'fake-card::nonfoil', qty: 1, source: 'searched' },
    ]);
  });
});
