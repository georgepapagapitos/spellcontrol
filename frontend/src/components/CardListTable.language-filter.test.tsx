// @vitest-environment happy-dom
/**
 * E161 — Language filter facet: predicate (only matching-language rows show)
 * and reset/count path (chip appears, × clears it, count decrements).
 *
 * Uses the same virtualizer/CardPreview mocks as the other CardListTable
 * filter tests so every virtual row renders in happy-dom.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
import { ShortcutRegistryProvider } from '../lib/shortcut-registry';

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

function renderTable(c: EnrichedCard[]) {
  return render(
    <ShortcutRegistryProvider>
      <MemoryRouter>
        <CardListTable cards={c} binders={[]} />
      </MemoryRouter>
    </ShortcutRegistryProvider>
  );
}

function openLanguageAndPick(labelText: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add language…' }));
  fireEvent.click(screen.getByRole('option', { name: labelText }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
}

describe('E161 — collection language filter', () => {
  beforeEach(() => {
    idSeq = 0;
    localStorage.setItem('mtg-collection-view-mode', 'list');
  });

  it('derives language options from the collection, not a hardcoded list', () => {
    // Only Japanese + (implicit) English are present — a fixed enum would
    // show every LANGUAGE_OPTIONS entry (Spanish, French, ...); the facet
    // must show only what's actually owned.
    renderTable([
      mk({ name: 'JCard', language: 'ja', scryfallId: 'sf-j' }),
      mk({ name: 'ECard', scryfallId: 'sf-e' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add language…' }));
    expect(screen.getByRole('option', { name: 'Japanese' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'English' })).toBeDefined();
    expect(screen.queryByRole('option', { name: 'Spanish' })).toBeNull();
  });

  it('predicate: filters rows to the selected language; absent language means English', () => {
    renderTable([
      mk({ name: 'JCard', language: 'ja', scryfallId: 'sf-j' }),
      mk({ name: 'ECard', scryfallId: 'sf-e' }), // no language set → treated as English
    ]);

    openLanguageAndPick('Japanese');

    expect(screen.getByRole('button', { name: /jcard/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /ecard/i })).toBeNull();
  });

  it('reset/count: shows an active-filter chip and clears via ×, restoring all rows', () => {
    renderTable([
      mk({ name: 'JCard', language: 'ja', scryfallId: 'sf-j' }),
      mk({ name: 'ECard', scryfallId: 'sf-e' }),
    ]);

    openLanguageAndPick('Japanese');

    const chipsGroup = screen.getByRole('group', { name: 'Active filters' });
    expect(within(chipsGroup).getByText(/Language: Japanese/)).toBeDefined();

    const clearBtn = within(chipsGroup).getByRole('button', {
      name: 'Remove filter: Language: Japanese',
    });
    fireEvent.click(clearBtn);

    expect(screen.queryByRole('group', { name: 'Active filters' })).toBeNull();
    expect(screen.getByRole('button', { name: /jcard/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /ecard/i })).toBeDefined();
  });
});
