// @vitest-environment happy-dom
/**
 * T153 decision C: the collection search hands off to the Add cards sheet
 * instead of opening a second, duplicate Scryfall search panel inline. These
 * tests replace the old inline-panel coverage (there never was a dedicated
 * suite for it — CardListTable.ux301.test.tsx only worked around the trigger
 * in its fixtures, see its "falls through to Scryfall trigger" comments).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EnrichedCard } from '../types';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 40,
        size: 40,
      })),
    getTotalSize: () => count * 40,
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

vi.mock('./CardPreview', () => ({
  CardPreview: () => <div data-testid="card-preview" />,
}));

import { CardListTable } from './CardListTable';
import { ShortcutRegistryProvider } from './shortcut-registry';

let idSeq = 0;
function mk(o: Partial<EnrichedCard> = {}): EnrichedCard {
  idSeq += 1;
  return {
    copyId: `copy-${idSeq}`,
    name: `Card ${idSeq}`,
    setCode: 'TST',
    setName: 'Test Set',
    collectorNumber: `${idSeq}`,
    rarity: 'common',
    scryfallId: `sf-${idSeq}`,
    purchasePrice: 1,
    sourceCategory: '',
    sourceFormat: 'plain',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Instant',
    cmc: 1,
    ...o,
  } as EnrichedCard;
}

function renderTable(cards: EnrichedCard[], onAddCards = vi.fn()) {
  render(
    <ShortcutRegistryProvider>
      <MemoryRouter>
        <CardListTable cards={cards} binders={[]} onAddCards={onAddCards} />
      </MemoryRouter>
    </ShortcutRegistryProvider>
  );
  return onAddCards;
}

beforeEach(() => {
  idSeq = 0;
});

describe('collection search hand-off (T153 decision C)', () => {
  it('shows an "Add cards" hand-off in list view once the query reaches 2 characters, and opens the sheet with it', async () => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    const onAddCards = renderTable([mk({ name: 'Sol Ring' })]);

    const searchInput = screen.getByRole('textbox', { name: /search/i });
    fireEvent.change(searchInput, { target: { value: 'dark ritual' } });

    const handoff = await waitFor(() =>
      screen.getByRole('button', { name: 'Add “dark ritual” to your collection…' })
    );
    fireEvent.click(handoff);
    expect(onAddCards).toHaveBeenCalledWith('dark ritual');
  });

  it('shows the hand-off as a trailing grid tile in grid view', async () => {
    localStorage.setItem('mtg-collection-view-mode', 'grid');
    const onAddCards = renderTable([mk({ name: 'Sol Ring' })]);

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'sol ring' },
    });

    const handoff = await waitFor(() =>
      screen.getByRole('button', { name: 'Add “sol ring” to your collection…' })
    );
    expect(handoff.className).toContain('collection-grid-item');
    fireEvent.click(handoff);
    expect(onAddCards).toHaveBeenCalledWith('sol ring');
  });

  it('shows the hand-off even with zero local matches, instead of the "No matches" empty state', async () => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    renderTable([mk({ name: 'Forest' })]);

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'zzz no match' },
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Add “zzz no match” to your collection…' })
      ).toBeTruthy()
    );
    expect(screen.queryByText('No matches.')).toBeNull();
  });

  it('renders no second live-search panel — no "Scryfall" copy anywhere on this surface', async () => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    renderTable([mk({ name: 'Forest' })]);

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'island' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add “island” to your collection…' })).toBeTruthy()
    );
    expect(screen.queryByText(/Scryfall/)).toBeNull();
  });

  it('does not render the hand-off under 2 characters', () => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    renderTable([mk({ name: 'Forest' })]);

    fireEvent.change(screen.getByRole('textbox', { name: /search/i }), {
      target: { value: 'i' },
    });
    expect(screen.queryByText(/to your collection/)).toBeNull();
  });
});

describe('the "A" shortcut opens Add cards', () => {
  it('opens Add cards on "a", and ignores it while typing in the search box', () => {
    localStorage.setItem('mtg-collection-view-mode', 'list');
    const onAddCards = renderTable([mk({ name: 'Forest' })]);

    fireEvent.keyDown(document, { key: 'a' });
    expect(onAddCards).toHaveBeenCalledWith();

    onAddCards.mockClear();
    const searchInput = screen.getByRole('textbox', { name: /search/i });
    fireEvent.keyDown(searchInput, { key: 'a' });
    expect(onAddCards).not.toHaveBeenCalled();
  });
});
