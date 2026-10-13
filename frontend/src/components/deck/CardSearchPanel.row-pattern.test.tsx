// @vitest-environment happy-dom
/**
 * E1007: an add-cards result row holds its own add / preview / dismiss buttons,
 * and an ARIA option cannot contain interactive content (axe nested-interactive).
 * So the rows are plain list items, the search input drives the highlighted row
 * with the arrow keys, and the row is announced through the live region instead
 * of `aria-activedescendant`. This pins the pattern: if rows go back to being
 * options, the nightly overlay walk fails on it and so does this.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import { useCollectionStore } from '../../store/collection';
import type { EnrichedCard } from '../../types';

vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));
vi.mock('@/lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('@/lib/discover/aggregates-client', () => ({
  getCommanderStats: () => Promise.resolve(null),
}));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: () => Promise.resolve({ data: [] }),
  getCardByNameResilient: (name: string) => Promise.resolve({ id: name, name }),
}));

function card(name: string): EnrichedCard {
  return {
    id: name,
    name,
    quantity: 1,
    colorIdentity: ['R'],
    legalities: { commander: 'legal' },
  } as unknown as EnrichedCard;
}

function renderPanel(onAdd = vi.fn()) {
  render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={['R']}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={onAdd}
      onClose={() => {}}
      addZone="main"
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
  return onAdd;
}

describe('CardSearchPanel result rows (E1007)', () => {
  beforeEach(() => {
    useCollectionStore.setState({ cards: [card('Ancient Tomb'), card('Lightning Bolt')] });
  });

  it('are list items holding their buttons, never options', () => {
    renderPanel();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    const list = screen.getByRole('list', { name: 'Search results' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(within(row).getAllByRole('button').length).toBeGreaterThan(0);
    }
  });

  it('the input no longer points at a row it cannot name, so arrow keys announce it', () => {
    renderPanel();
    const input = screen.getByRole('textbox', { name: 'Search your collection' });
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(input.getAttribute('aria-controls')).toBeNull();

    const rows = () => document.querySelectorAll<HTMLElement>('.inline-card-search-item');
    expect(rows()[0].getAttribute('aria-current')).toBe('true');
    expect(rows()[1].getAttribute('aria-current')).toBeNull();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(rows()[0].getAttribute('aria-current')).toBeNull();
    expect(rows()[1].getAttribute('aria-current')).toBe('true');
  });

  it('Enter adds the highlighted row', async () => {
    const onAdd = renderPanel();
    const input = screen.getByRole('textbox', { name: 'Search your collection' });
    const second = document.querySelectorAll<HTMLElement>('.inline-card-search-item')[1];
    const name = second.dataset.resultName;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(onAdd.mock.calls[0])).toContain(name);
  });
});
