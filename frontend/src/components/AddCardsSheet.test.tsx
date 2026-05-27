// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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
  scryfallHits: 1,
  format: 'mtga',
}));
vi.mock('../lib/api', () => ({
  importText: (text: string) => importTextMock(text),
}));

const importCardsMock = vi.fn(async (..._args: unknown[]) => 'import-id');
vi.mock('../store/collection', () => ({
  useCollectionStore: (selector: (s: { importCards: typeof importCardsMock }) => unknown) =>
    selector({ importCards: importCardsMock }),
}));

import { AddCardsSheet } from './AddCardsSheet';
import { useCanScan } from '../lib/use-can-scan';

beforeEach(() => {
  importTextMock.mockClear();
  importCardsMock.mockClear();
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

  it('fires onClose on Escape', () => {
    const onClose = vi.fn();
    render(<AddCardsSheet onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
