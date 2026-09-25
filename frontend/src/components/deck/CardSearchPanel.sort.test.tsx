// @vitest-environment happy-dom
/**
 * The add-cards Sort control (E423 lane G): it used to be a native <select>,
 * now SelectMenu (STYLE_GUIDE § Config surfaces). SortMenu doesn't fit here —
 * `compareResults`/`AddSort` has no direction concept, each field sorts a
 * fixed way, so there is nothing for a Reverse action to flip.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import { useCollectionStore } from '../../store/collection';
import type { EnrichedCard } from '../../types';

vi.mock('../../lib/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/card-thumbs')>()),
  useCardThumb: () => undefined,
}));
vi.mock('../../lib/api', () => ({ useSetMap: () => ({}) }));
vi.mock('../../lib/aggregates-client', () => ({ getCommanderStats: () => Promise.resolve(null) }));
vi.mock('@/deck-builder/services/scryfall/client', () => ({
  searchCards: () => Promise.resolve({ data: [] }),
  getCardByNameResilient: () => Promise.resolve(null),
}));

function card(name: string, colorIdentity: string[]): EnrichedCard {
  return {
    id: name,
    name,
    quantity: 1,
    colorIdentity,
    legalities: { commander: 'legal' },
  } as unknown as EnrichedCard;
}

function renderPanel() {
  const r = render(
    <CardSearchPanel
      deckId="deck-1"
      commanderColorIdentity={['R']}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={() => {}}
      onClose={() => {}}
      addZone="main"
    />
  );
  fireEvent.click(screen.getByRole('tab', { name: /Collection/ }));
  return r;
}

describe('CardSearchPanel — Sort control', () => {
  beforeEach(() => {
    useCollectionStore.setState({
      cards: [card('Lightning Bolt', ['R']), card('Ancient Tomb', [])],
    });
  });

  it('is a menu button + listbox, not a native <select>', () => {
    renderPanel();
    const trigger = screen.getByRole('button', { name: 'Sort' });
    expect(trigger.tagName).toBe('BUTTON');
    expect(document.querySelector('select')).toBeNull();
  });

  it('picking an option re-sorts the results by that field', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('option', { name: 'Name' }));

    const rows = Array.from(document.querySelectorAll('.card-search-row'));
    const names = rows.map((r) => r.querySelector('.card-search-name')?.textContent);
    expect(names.indexOf('Ancient Tomb')).toBeLessThan(names.indexOf('Lightning Bolt'));
  });
});
