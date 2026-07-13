// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import type { EnrichedCard, FetchErrorRow, UploadResponse } from '../types';
import type { ImportHistoryEntry } from '../lib/local-cards';

// UploadPanel's own commit path (importCards) and parse path (importText) are
// mocked; everything else (Modal, ConfirmDialog, useConfirm, card-tags,
// InlineCardSearch) is real, so these are integration-style tests of the
// reimport gate + replace confirm wiring + the single review surface,
// rather than unit tests of any one function.
const importTextMock = vi.fn<(text: string) => Promise<UploadResponse>>();
vi.mock('../lib/api', () => ({
  importText: (text: string) => importTextMock(text),
  importFile: vi.fn(),
  importRows: vi.fn(),
}));

// InlineCardSearch (rendered by the unresolved-name repair row) hits Scryfall
// search through this client — stub it so repair tests control the results.
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: vi.fn(),
}));

interface MockState {
  cards: EnrichedCard[];
  binders: never[];
  isLoading: boolean;
  error: string | null;
  unresolvedNames: string[];
  fetchErrors: FetchErrorRow[];
  importHistory: ImportHistoryEntry[];
  importCards: ReturnType<typeof vi.fn>;
  deleteImports: ReturnType<typeof vi.fn>;
  clearCards: ReturnType<typeof vi.fn>;
  setLoading: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
  restoreFromBackup: ReturnType<typeof vi.fn>;
  addCard: ReturnType<typeof vi.fn>;
  replaceAllCards: ReturnType<typeof vi.fn>;
}

const importCardsMock = vi.fn(async (..._args: unknown[]) => 'new-import-id');
const addCardMock = vi.fn(async (..._args: unknown[]) => ['new-copy-id']);

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
  addCard: addCardMock,
  replaceAllCards: vi.fn(),
};

function useCollectionStoreMock<T>(selector: (s: MockState) => T): T {
  return selector(mockState);
}
type StatePatch = Partial<MockState> | ((s: MockState) => Partial<MockState>);
useCollectionStoreMock.setState = (patch: StatePatch) =>
  Object.assign(mockState, typeof patch === 'function' ? patch(mockState) : patch);

vi.mock('../store/collection', () => ({
  useCollectionStore: Object.assign(
    (selector: (s: MockState) => unknown) => useCollectionStoreMock(selector),
    { setState: (patch: StatePatch) => useCollectionStoreMock.setState(patch) }
  ),
}));

import { UploadPanel } from './UploadPanel';
import { searchCards } from '@/deck-builder/services/scryfall/client';

const mockSearchCards = searchCards as ReturnType<typeof vi.fn>;

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
  addCardMock.mockClear();
  mockSearchCards.mockReset();
  mockState.cards = [];
  mockState.importHistory = [];
  mockState.unresolvedNames = [];
  mockState.fetchErrors = [];
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

describe('UploadPanel import review surface (E130)', () => {
  it('folds fetch-errors and unresolved names into ONE review container', () => {
    mockState.cards = [card(1)];
    mockState.fetchErrors = [{ name: 'Foo', quantity: 2 }];
    mockState.unresolvedNames = ['Sol Rign'];

    const { container } = render(<UploadPanel />);

    // One consolidated surface, not one box per bucket.
    expect(container.querySelectorAll('.import-review')).toHaveLength(1);
    expect(screen.getByText('Import needs a look')).toBeTruthy();

    // Fetch errors keep their Retry affordance (E72 contract).
    expect(screen.getByText(/couldn't be fetched/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    // Unresolved names are listed and repairable inline — scope to that
    // section since the fetch-error section also has its own "Show list".
    const unresolvedSection = screen
      .getByText(/couldn't be matched to Scryfall data/)
      .closest('.import-review-section') as HTMLElement;
    fireEvent.click(within(unresolvedSection).getByRole('button', { name: 'Show list' }));
    expect(within(unresolvedSection).getByText('Sol Rign')).toBeTruthy();
    expect(within(unresolvedSection).getByRole('button', { name: /Fix/ })).toBeTruthy();
  });

  it('reads as a plain summary when nothing needs action', () => {
    mockState.cards = [card(1)];
    mockState.fetchErrors = [];
    mockState.unresolvedNames = [];
    // No routing/success state either — nothing to review.
    render(<UploadPanel />);
    expect(screen.queryByText('Import needs a look')).toBeNull();
    expect(screen.queryByText('Import summary')).toBeNull();
  });

  it('repairs an unresolved name inline via search-and-add, without a new lookup UI', async () => {
    mockState.cards = [card(1)];
    mockState.unresolvedNames = ['Sol Rign'];
    mockSearchCards.mockResolvedValue({
      data: [{ id: 'sf-sol-ring', name: 'Sol Ring', finishes: ['nonfoil'] }],
    });

    render(<UploadPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show list' }));
    fireEvent.click(screen.getByRole('button', { name: /Fix/ }));

    // The search box is prefilled with the withheld name (suggestions-first,
    // manual search stays available since it's a plain editable input).
    const input = screen.getByLabelText('Search Scryfall to fix "Sol Rign"') as HTMLInputElement;
    expect(input.value).toBe('Sol Rign');

    const match = await screen.findByText('Sol Ring', {}, { timeout: 2000 });
    fireEvent.click(screen.getByRole('button', { name: 'Add Sol Ring' }));

    await waitFor(() => expect(addCardMock).toHaveBeenCalledTimes(1));
    expect(addCardMock.mock.calls[0][0]).toMatchObject({ name: 'Sol Ring' });
    // The row shows its own resolved state...
    expect(await screen.findByText(/added/)).toBeTruthy();
    // ...and the repair removed the name from the store's withheld bucket.
    expect(mockState.unresolvedNames).toEqual([]);
    expect(match).toBeTruthy();
  });
});
