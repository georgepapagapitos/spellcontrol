// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import type { EnrichedCard, UploadResponse } from '../types';
import type { ImportHistoryEntry } from '../lib/local-cards';

// UploadPanel's own commit path (importCards) and parse path (importText) are
// mocked; everything else (Modal, ConfirmDialog, useConfirm, card-tags) is
// real, so these are integration-style tests of the reimport gate + replace
// confirm wiring rather than unit tests of any one function.
const importTextMock = vi.fn<(text: string) => Promise<UploadResponse>>();
vi.mock('../lib/api', () => ({
  importText: (text: string) => importTextMock(text),
  importFile: vi.fn(),
  importRows: vi.fn(),
}));

interface MockState {
  cards: EnrichedCard[];
  binders: never[];
  isLoading: boolean;
  error: string | null;
  unresolvedNames: string[];
  fetchErrors: never[];
  importHistory: ImportHistoryEntry[];
  importCards: ReturnType<typeof vi.fn>;
  deleteImports: ReturnType<typeof vi.fn>;
  clearCards: ReturnType<typeof vi.fn>;
  setLoading: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
  restoreFromBackup: ReturnType<typeof vi.fn>;
}

const importCardsMock = vi.fn(async (..._args: unknown[]) => 'new-import-id');

const mockState: MockState = {
  cards: [],
  binders: [],
  isLoading: false,
  error: null,
  unresolvedNames: [],
  fetchErrors: [],
  importHistory: [],
  importCards: importCardsMock,
  deleteImports: vi.fn(),
  clearCards: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  restoreFromBackup: vi.fn(),
};

function useCollectionStoreMock<T>(selector: (s: MockState) => T): T {
  return selector(mockState);
}
useCollectionStoreMock.setState = (patch: Partial<MockState>) => Object.assign(mockState, patch);

vi.mock('../store/collection', () => ({
  useCollectionStore: Object.assign(
    (selector: (s: MockState) => unknown) => useCollectionStoreMock(selector),
    { setState: (patch: Partial<MockState>) => useCollectionStoreMock.setState(patch) }
  ),
}));

import { UploadPanel } from './UploadPanel';

function card(i: number, importId?: string): EnrichedCard {
  return {
    copyId: `copy-${i}`,
    name: `Card ${i}`,
    setCode: 'set',
    setName: 'Set',
    collectorNumber: String(i),
    rarity: 'common',
    scryfallId: `sf-${i}`,
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: 'manabox',
    importId,
    finish: 'nonfoil',
    foil: false,
  };
}

function mkResponse(cards: EnrichedCard[]): UploadResponse {
  return {
    cards,
    totalRows: cards.length,
    scryfallHits: cards.length,
    scryfallMisses: 0,
    unresolvedNames: [],
    fetchErrors: [],
    malformedRows: [],
    skippedUnownedRows: 0,
    clampedRows: 0,
    detectedFormat: 'manabox',
  };
}

const PRIOR: ImportHistoryEntry = {
  id: 'imp1',
  name: 'old-export.csv',
  count: 20,
  format: 'manabox',
  addedAt: Date.now() - 1_000_000,
};

async function paste(text = '1 Forest') {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await screen.findByText('How should these cards be imported?');
}

beforeEach(() => {
  importTextMock.mockReset();
  importCardsMock.mockClear();
  mockState.cards = [];
  mockState.importHistory = [];
});

describe('UploadPanel reimport gate (content-based)', () => {
  it('gates a merge import whose content overlaps a prior import almost entirely', async () => {
    mockState.cards = Array.from({ length: 20 }, (_, i) => card(i, 'imp1'));
    mockState.importHistory = [PRIOR];
    importTextMock.mockResolvedValue(mkResponse(Array.from({ length: 20 }, (_, i) => card(i))));

    render(<UploadPanel />);
    await paste();
    fireEvent.click(screen.getByRole('button', { name: /Add to collection/ }));

    await screen.findByText('This looks like a re-import');
    expect(importCardsMock).not.toHaveBeenCalled();
  });

  it('"Merge anyway" proceeds with the merge, no further confirm', async () => {
    mockState.cards = Array.from({ length: 20 }, (_, i) => card(i, 'imp1'));
    mockState.importHistory = [PRIOR];
    importTextMock.mockResolvedValue(mkResponse(Array.from({ length: 20 }, (_, i) => card(i))));

    render(<UploadPanel />);
    await paste();
    fireEvent.click(screen.getByRole('button', { name: /Add to collection/ }));
    await screen.findByText('This looks like a re-import');

    fireEvent.click(screen.getByRole('button', { name: 'Merge anyway' }));

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('merge');
    expect(screen.queryByText('This looks like a re-import')).toBeNull();
  });

  it('"Cancel" discards the parsed import — nothing is committed', async () => {
    mockState.cards = Array.from({ length: 20 }, (_, i) => card(i, 'imp1'));
    mockState.importHistory = [PRIOR];
    importTextMock.mockResolvedValue(mkResponse(Array.from({ length: 20 }, (_, i) => card(i))));

    render(<UploadPanel />);
    await paste();
    fireEvent.click(screen.getByRole('button', { name: /Add to collection/ }));
    await screen.findByText('This looks like a re-import');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('This looks like a re-import')).toBeNull();
    expect(importCardsMock).not.toHaveBeenCalled();
  });

  it('"Replace instead" from the gate requires the replace confirm, then commits as replace', async () => {
    mockState.cards = Array.from({ length: 20 }, (_, i) => card(i, 'imp1'));
    mockState.importHistory = [PRIOR];
    importTextMock.mockResolvedValue(mkResponse(Array.from({ length: 20 }, (_, i) => card(i))));

    render(<UploadPanel />);
    await paste();
    fireEvent.click(screen.getByRole('button', { name: /Add to collection/ }));
    await screen.findByText('This looks like a re-import');

    fireEvent.click(screen.getByRole('button', { name: 'Replace instead' }));

    const confirmHeading = await screen.findByText('Replace your collection?');
    expect(importCardsMock).not.toHaveBeenCalled(); // gated until confirmed
    const confirmDialog = confirmHeading.closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('replace');
  });

  it('does not gate a disjoint import (no meaningful overlap)', async () => {
    mockState.cards = Array.from({ length: 20 }, (_, i) => card(i, 'imp1'));
    mockState.importHistory = [PRIOR];
    // Distinct printings from the existing collection — a genuinely new batch.
    importTextMock.mockResolvedValue(
      mkResponse(Array.from({ length: 20 }, (_, i) => card(i + 1000)))
    );

    render(<UploadPanel />);
    await paste();
    fireEvent.click(screen.getByRole('button', { name: /Add to collection/ }));

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('merge');
    expect(screen.queryByText('This looks like a re-import')).toBeNull();
  });
});

describe('UploadPanel replace-mode confirm', () => {
  it('requires a confirm before replacing a NON-EMPTY collection', async () => {
    mockState.cards = Array.from({ length: 5 }, (_, i) => card(i, 'imp1'));
    importTextMock.mockResolvedValue(mkResponse([card(999)]));

    render(<UploadPanel />);
    await paste();
    fireEvent.click(screen.getByRole('button', { name: /Replace collection/ }));

    const confirmHeading = await screen.findByText('Replace your collection?');
    expect(importCardsMock).not.toHaveBeenCalled();

    const confirmDialog = confirmHeading.closest('[role="dialog"]') as HTMLElement;
    // Cancelling the confirm aborts — the mode dialog is still up underneath.
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Replace your collection?')).toBeNull();
    expect(importCardsMock).not.toHaveBeenCalled();
    expect(screen.getByText('How should these cards be imported?')).toBeTruthy();

    // Try again and confirm this time.
    fireEvent.click(screen.getByRole('button', { name: /Replace collection/ }));
    const confirmHeading2 = await screen.findByText('Replace your collection?');
    const confirmDialog2 = confirmHeading2.closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(confirmDialog2).getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('replace');
  });

  it('does not nag when replacing an EMPTY collection', async () => {
    mockState.cards = [];
    importTextMock.mockResolvedValue(mkResponse([card(1)]));

    render(<UploadPanel />);
    await paste();
    // With an empty collection, "Add to collection" itself resolves to replace mode.
    fireEvent.click(screen.getByRole('button', { name: /Add to collection/ }));

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('replace');
    expect(screen.queryByText('Replace your collection?')).toBeNull();
  });
});
