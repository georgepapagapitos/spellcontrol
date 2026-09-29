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
const importTextMock =
  vi.fn<(text: string, onProgress?: unknown, proxy?: boolean) => Promise<UploadResponse>>();
const fetchImportLinkMock = vi.fn<(url: string) => Promise<{ text: string; name: string }>>();
vi.mock('../lib/api', () => ({
  importText: (text: string, onProgress?: unknown, proxy?: boolean) =>
    importTextMock(text, onProgress, proxy),
  importFile: vi.fn(),
  importRows: vi.fn(),
  fetchImportLink: (url: string) => fetchImportLinkMock(url),
  // Read by useBinderLayoutInputs (E457), shared by the routing summary —
  // irrelevant to what these tests assert.
  useSetMap: vi.fn(() => undefined),
}));

// The Drive picker decides which import affordance renders at all, and it reads
// its credentials from import.meta.env — which means a developer with a real
// .env.local would exercise a DIFFERENT branch than CI. Mock it so both
// branches are chosen by the test, never by the environment.
const pickerAvailableMock = vi.fn(() => false);
const pickFromDriveMock = vi.fn<() => Promise<File[]>>();
// vi.hoisted: `vi.mock` is lifted above ordinary declarations, so a plain
// `class` here is still in its temporal dead zone when the factory runs.
const { CancelledError } = vi.hoisted(() => ({
  CancelledError: class CancelledError extends Error {
    constructor() {
      super('cancelled');
      this.name = 'CancelledError';
    }
  },
}));
vi.mock('../lib/google-picker', () => ({
  googlePickerAvailable: () => pickerAvailableMock(),
  googlePickerConfigured: () => pickerAvailableMock(),
  pickFromGoogleDrive: () => pickFromDriveMock(),
  warmGooglePicker: () => {},
  CancelledError,
  isCancelled: (e: unknown) => e instanceof CancelledError,
}));

// InlineCardSearch (rendered by the unresolved-name repair row) hits Scryfall
// search through this client — stub it so repair tests control the results.
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCollectibleCards: vi.fn(),
}));

// The background server push (a big import saving to the account after the
// panel has let go) reports through this hook; null = nothing in flight.
const pushProgressMock = vi.fn<() => { done: number; total: number; ops: number } | null>(
  () => null
);
vi.mock('../lib/use-push-progress', () => ({
  usePushProgress: () => pushProgressMock(),
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
  setLoading: ReturnType<typeof vi.fn>;
  setError: ReturnType<typeof vi.fn>;
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
  setLoading: vi.fn(),
  setError: vi.fn(),
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
import { searchCollectibleCards } from '@/deck-builder/services/scryfall/client';

const mockSearchCards = searchCollectibleCards as ReturnType<typeof vi.fn>;

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

// Importing adds straight away by default (D, board T153) — there is no
// per-click mode dialog to wait for anymore. Callers that need the rarer
// modes open "Options" first (see openOptions/pickMode below).
function paste(text = '1 Forest') {
  // Named query: the Google-link field is a textbox in this card too.
  fireEvent.change(screen.getByRole('textbox', { name: /card list to import/i }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
}

/** Opens the "Options" disclosure (binder/replace mode, proxies) — closed by default. */
function openOptions() {
  fireEvent.click(screen.getByRole('button', { name: /^Options/ }));
}

/** Picks a mode from the Options ChoiceList. Caller opens Options first. */
function pickMode(name: RegExp) {
  fireEvent.click(screen.getByRole('radio', { name }));
}

beforeEach(() => {
  importTextMock.mockReset();
  fetchImportLinkMock.mockReset();
  pickerAvailableMock.mockReturnValue(false);
  pickFromDriveMock.mockReset();
  importCardsMock.mockClear();
  addCardMock.mockClear();
  mockSearchCards.mockReset();
  pushProgressMock.mockReturnValue(null);
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
    paste();

    await screen.findByText('This looks like a re-import');
    expect(importCardsMock).not.toHaveBeenCalled();
  });

  it('"Merge anyway" proceeds with the merge, no further confirm', async () => {
    mockState.cards = Array.from({ length: 20 }, (_, i) => card(i, 'imp1'));
    mockState.importHistory = [PRIOR];
    importTextMock.mockResolvedValue(mkResponse(Array.from({ length: 20 }, (_, i) => card(i))));

    render(<UploadPanel />);
    paste();
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
    paste();
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
    paste();
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
    paste();

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('merge');
    expect(screen.queryByText('This looks like a re-import')).toBeNull();
  });
});

describe('UploadPanel background save progress', () => {
  // After a big import the store hands the collection back as soon as the
  // rows are on the device; the server push carries on in the background and
  // the panel keeps a non-blocking strip up until it settles.
  it('shows the account-save strip while a chunked push is in flight, without loading', () => {
    mockState.isLoading = false;
    pushProgressMock.mockReturnValue({ done: 2, total: 7, ops: 13000 });
    const { container } = render(<UploadPanel />);
    expect(screen.getByText('Saving to your account · 3 of 7…')).toBeTruthy();
    const bar = container.querySelector('.upload-progress [role="progressbar"]');
    expect(Number(bar?.getAttribute('aria-valuenow'))).toBeCloseTo((2 / 7) * 100, 5);
  });

  it('shows no strip when nothing is in flight', () => {
    mockState.isLoading = false;
    render(<UploadPanel />);
    expect(screen.queryByText(/Saving to your account/)).toBeNull();
    expect(document.querySelector('.upload-progress')).toBeNull();
  });
});

describe('UploadPanel "mark all as proxies" toggle', () => {
  // Moved inside the "Options" disclosure alongside the rarer import modes
  // (D, board T153) — closed by default, so every query here opens it first.
  it('is a switch row with a visible hint, not a checkbox with a nested InfoTip', () => {
    render(<UploadPanel />);
    openOptions();
    const row = screen.getByRole('switch', { name: 'Mark all as proxies' });
    expect(row.getAttribute('aria-checked')).toBe('false');
    // The explainer is always-visible text (Field/SwitchRow contract), not an
    // InfoTip nested inside a <label> — the InfoTip pattern muddles the
    // label's accessible name and steals its click.
    expect(screen.getByText('Counts as owned, with no market value.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /marking an import as proxies/i })).toBeNull();
  });

  it('threads proxy:true to importText when checked before a paste import', async () => {
    importTextMock.mockResolvedValue(mkResponse([card(1)]));

    render(<UploadPanel />);
    openOptions();
    fireEvent.click(screen.getByRole('switch', { name: /mark all as proxies/i }));
    paste();

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importTextMock).toHaveBeenCalledWith('1 Forest', expect.anything(), true);
  });

  it('leaves proxy undefined when the toggle is left off', async () => {
    importTextMock.mockResolvedValue(mkResponse([card(1)]));

    render(<UploadPanel />);
    paste();

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importTextMock).toHaveBeenCalledWith('1 Forest', expect.anything(), false);
  });
});

describe('UploadPanel — import with no mode dialog (D, board T153)', () => {
  it('adds to the collection straight away — no dialog blocks the click', async () => {
    importTextMock.mockResolvedValue(mkResponse([card(1)]));

    render(<UploadPanel />);
    paste();

    // Nothing to confirm or click through — the default mode commits at once.
    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('merge');
    expect(screen.queryByText('How should these cards be imported?')).toBeNull();
  });

  it('names the routing once a binder exists, in the Options hint, not a dialog', () => {
    (mockState as { binders: unknown[] }).binders = [{ id: 'b1', name: 'Bulk', filterGroups: [] }];
    render(<UploadPanel />);
    openOptions();
    expect(screen.getByText(/routed through your binder rules/)).toBeTruthy();
    (mockState as { binders: unknown[] }).binders = [];
  });
});

describe('UploadPanel Options — replace my collection', () => {
  it('requires a confirm before replacing a NON-EMPTY collection, with Undo', async () => {
    mockState.cards = Array.from({ length: 5 }, (_, i) => card(i, 'imp1'));
    importTextMock.mockResolvedValue(mkResponse([card(999)]));

    render(<UploadPanel />);
    openOptions();
    pickMode(/Replace my collection/);
    paste();

    const confirmHeading = await screen.findByText('Replace your collection?');
    expect(importCardsMock).not.toHaveBeenCalled();
    // The confirm names the Undo the store's replace path offers.
    expect(screen.getByText(/You can undo it right after/)).toBeTruthy();

    const confirmDialog = confirmHeading.closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Replace your collection?')).toBeNull();
    expect(importCardsMock).not.toHaveBeenCalled();

    // Try again and confirm this time.
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
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
    openOptions();
    pickMode(/Replace my collection/);
    paste();

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('replace');
    expect(screen.queryByText('Replace your collection?')).toBeNull();
  });
});

describe('UploadPanel Options — add as a new binder', () => {
  it('is disabled until a binder name is entered, then imports as binder', async () => {
    importTextMock.mockResolvedValue(mkResponse([card(1)]));

    render(<UploadPanel />);
    fireEvent.change(screen.getByRole('textbox', { name: /card list to import/i }), {
      target: { value: '1 Forest' },
    });
    openOptions();
    pickMode(/Add as a new binder/);

    const importBtn = screen.getByRole('button', { name: 'Import' }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: 'Binder name' }), {
      target: { value: 'My cube' },
    });
    expect(importBtn.disabled).toBe(false);
    fireEvent.click(importBtn);

    await waitFor(() => expect(importCardsMock).toHaveBeenCalledTimes(1));
    expect(importCardsMock.mock.calls[0][2]).toBe('binder');
    expect(importCardsMock.mock.calls[0][3]).toMatchObject({ binderName: 'My cube' });
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
      .getByText(/didn't match Scryfall/)
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
      data: [
        {
          id: 'sf-sol-ring',
          name: 'Sol Ring',
          set: 'cmm',
          collector_number: '410',
          finishes: ['nonfoil'],
        },
      ],
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

describe('UploadPanel Google Drive picker', () => {
  beforeEach(() => pickerAvailableMock.mockReturnValue(true));

  it('offers the Drive picker instead of the link field when it can run', () => {
    render(<UploadPanel />);
    expect(screen.getByRole('button', { name: /Google Drive/ })).toBeTruthy();
    // Two ways to reach the same place is clutter — the picker supersedes it.
    expect(screen.queryByLabelText('Google Sheets or Drive link')).toBeNull();
  });

  it('falls back to the link field where the picker cannot run', () => {
    // Native WebView / un-keyed build. A Sheet is unreachable by the OS
    // picker, so this fallback is the only way in on those platforms.
    pickerAvailableMock.mockReturnValue(false);
    render(<UploadPanel />);
    expect(screen.queryByRole('button', { name: /Google Drive/ })).toBeNull();
    expect(screen.getByLabelText('Google Sheets or Drive link')).toBeTruthy();
  });

  it('stages whatever the picker returns', async () => {
    pickFromDriveMock.mockResolvedValue([
      new File(['Name\nSol Ring\n'], 'My Collection.csv', { type: 'text/csv' }),
    ]);
    render(<UploadPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));

    expect(await screen.findByText('My Collection.csv')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import 1 file' })).toBeTruthy();
  });

  it('stages nothing when the user cancels the picker', async () => {
    pickFromDriveMock.mockResolvedValue([]);
    render(<UploadPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));

    await waitFor(() => expect(pickFromDriveMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Import 1 file/ })).toBeNull();
    expect(mockState.setError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('stays silent when the user cancels', async () => {
    pickFromDriveMock.mockRejectedValue(new CancelledError());
    render(<UploadPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));

    await waitFor(() => expect(pickFromDriveMock).toHaveBeenCalled());
    expect(mockState.setError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('does NOT swallow an error that merely has an empty message', async () => {
    // The bug this replaces: "silent" was encoded as an empty message, so a
    // real abort after a successful auth vanished without a banner or a log.
    pickFromDriveMock.mockRejectedValue(new Error(''));
    render(<UploadPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));

    await waitFor(() => expect(mockState.setError).toHaveBeenCalled());
  });

  it('surfaces a real picker failure', async () => {
    pickFromDriveMock.mockRejectedValue(new Error('Couldn’t reach Google.'));
    render(<UploadPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));

    await waitFor(() => expect(mockState.setError).toHaveBeenCalledWith('Couldn’t reach Google.'));
  });

  it('warns inline when a staged file name matches prior import history (the filename re-import signal)', async () => {
    mockState.importHistory = [PRIOR];
    pickFromDriveMock.mockResolvedValue([
      new File(['Name\nSol Ring\n'], PRIOR.name, { type: 'text/csv' }),
    ]);
    render(<UploadPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Google Drive/ }));

    const warning = await screen.findByText(/You already imported/);
    expect(warning.closest('.import-reimport-warning')?.textContent).toContain(PRIOR.name);
    expect(warning.closest('.import-reimport-warning')?.textContent).toContain(
      'Replace it in Options instead'
    );
  });
});

describe('UploadPanel Google-link import', () => {
  const linkField = () => screen.getByLabelText('Google Sheets or Drive link');

  it('stages the fetched file under the name Google gave it', async () => {
    fetchImportLinkMock.mockResolvedValue({
      text: 'Name,Quantity\nSol Ring,1\n',
      name: 'My Cards - Sheet1.csv',
    });

    render(<UploadPanel />);
    fireEvent.change(linkField(), {
      target: { value: 'https://docs.google.com/spreadsheets/d/ABC/edit#gid=0' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }));

    // It lands in the staged list, so the normal "Import N files" path takes
    // over from here — nothing about the link survives past this point.
    expect(await screen.findByText('My Cards - Sheet1.csv')).toBeTruthy();
    expect(fetchImportLinkMock).toHaveBeenCalledWith(
      'https://docs.google.com/spreadsheets/d/ABC/edit#gid=0'
    );
    expect(screen.getByRole('button', { name: 'Import 1 file' })).toBeTruthy();
    expect((linkField() as HTMLInputElement).value).toBe('');
  });

  it("surfaces the server's message and stages nothing when the fetch fails", async () => {
    fetchImportLinkMock.mockRejectedValue(new Error('Set access to "Anyone with the link".'));

    render(<UploadPanel />);
    fireEvent.change(linkField(), { target: { value: 'https://drive.google.com/open?id=X' } });
    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }));

    await waitFor(() =>
      expect(mockState.setError).toHaveBeenCalledWith('Set access to "Anyone with the link".')
    );
    expect(screen.queryByRole('button', { name: /Import 1 file/ })).toBeNull();
  });

  it('stays disabled until there is a link to fetch', () => {
    render(<UploadPanel />);
    const fetchBtn = screen.getByRole('button', { name: /Fetch/ }) as HTMLButtonElement;
    expect(fetchBtn.disabled).toBe(true);
    // Whitespace is not a link.
    fireEvent.change(linkField(), { target: { value: '   ' } });
    expect(fetchBtn.disabled).toBe(true);
  });
});

describe('UploadPanel no longer renders import admin (D, board T153)', () => {
  it('renders no import-history list, Restore, or Clear all — those moved to Collection ⋮ / Settings', () => {
    mockState.cards = [card(1)];
    mockState.importHistory = [PRIOR];
    render(<UploadPanel />);
    expect(screen.queryByText('Import history')).toBeNull();
    expect(screen.queryByText(PRIOR.name)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Clear all/ })).toBeNull();
  });
});
